import {Order as OrderModel} from "@/api/model/order.ts";
import {OrderItem} from "@/api/model/order_item.ts";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {OrderItemName} from "@/components/common/order/order.item.tsx";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {formatNumber} from "@/lib/utils.ts";
import React, {useMemo, useState} from "react";
import {faArrowLeft, faCheck, faPlus, faTrash} from "@fortawesome/free-solid-svg-icons";
import {useDB} from "@/api/db/db.ts";
import {toast} from "sonner";
import {canCarveUnit, carveUnit, commitSplit, linesRatio, orderHasPayments, partLines, splitErrorKey} from "@/lib/order-split.ts";
import {CarveUnitButton} from "@/components/orders/split/carve-unit-button.tsx";
import ScrollContainer from "react-indiana-drag-scroll";
import {nanoid} from "nanoid";
import {getInvoiceNumber, getOrderFilteredItems} from "@/lib/order.ts";
import {assertOrderMutationsAllowed} from "@/lib/closing.guard.ts";
import {useAtom} from "jotai";
import {appPage} from "@/store/jotai.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {useTranslation} from "react-i18next";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {tapSelectedClass, useTapToMove} from "@/components/orders/split/use-tap-to-move.ts";

interface Props {
  order: OrderModel
  onClose?: () => void;
}

interface Split {
  id: string;
  name: string;
  items: OrderItem[];
  number: number;
}

export const SplitItems = ({
  order, onClose
}: Props) => {
  const {t} = useTranslation(['orders', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);
  // Initialize with one split containing all items
  const [splits, setSplits] = useState<Split[]>([
    {id: 'split-1', name: t('split.splitName', {number: 1}), items: [...getOrderFilteredItems(order)], number: 1}
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [draggedItem, setDraggedItem] = useState<OrderItem | null>(null);
  const [dragOverSplit, setDragOverSplit] = useState<string | null>(null);

  // Calculate total for each split
  const splitTotals = useMemo(() => {
    return splits.map(split => {
      return split.items.reduce((total, item) => {
        return total + calculateOrderItemPrice(item);
      }, 0);
    });
  }, [splits]);

  // Get all splits
  const actualSplits = useMemo(() => {
    return splits;
  }, [splits]);

  const addSplit = () => {
    const newSplitId = nanoid();
    setSplits(prev => [...prev, {
      id: newSplitId,
      name: t('split.splitName', {number: prev.length + 1}),
      number: prev.length + 1,
      items: []
    }]);
  };

  const removeSplit = (splitId: string) => {
    if (splits.length > 1) {
      setSplits(prev => {
        // Move items back to first split (Split 1)
        const removedItems = prev.find(split => split.id === splitId)?.items ?? [];
        const filtered = prev.filter(split => split.id !== splitId);
        // Renumber splits to maintain sequential naming
        return filtered.map((split, index) => ({
          ...split,
          items: split.id === 'split-1' ? [...split.items, ...removedItems] : split.items,
          name: t('split.splitName', {number: index + 1}),
          number: index + 1
        }));
      });
    }
  };

  const moveItemToSplit = (item: OrderItem, splitId: string) => {
    setSplits(prev => {
      // Find which split currently contains this item
      const currentSplit = prev.find(split => split.items.some(splitItem => splitItem.id === item.id));
      
      // If the item is already in the target split, do nothing
      if (currentSplit && currentSplit.id === splitId) {
        return prev;
      }
      
      // Move the item to the target split
      return prev.map(split => {
        if (split.id === splitId) {
          // Add item to this split
          return {
            ...split,
            items: [...split.items, item]
          };
        } else {
          // Remove item from other splits
          return {
            ...split,
            items: split.items.filter(splitItem => splitItem.id !== item.id)
          };
        }
      });
    });
  };

  const tap = useTapToMove(moveItemToSplit);

  // One unit of a multi-unit line becomes its own line (3 beers for 3 guests).
  const carveOne = (item: OrderItem, splitId: string) => {
    setSplits(prev => prev.map(split => split.id !== splitId ? split : {
      ...split,
      items: split.items.flatMap(line => line.id === item.id ? carveUnit(line) : [line]),
    }));
  };


  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, item: OrderItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  };

  const handleDragOver = (e: React.DragEvent, splitId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSplit(splitId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverSplit(null);
  };

  const handleDrop = (e: React.DragEvent, splitId: string) => {
    e.preventDefault();
    if (draggedItem) {
      moveItemToSplit(draggedItem, splitId);
    }
    setDraggedItem(null);
    setDragOverSplit(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverSplit(null);
  };

  const removeItemFromSplit = (itemId: string, splitId: string) => {
    setSplits(prev => {
      const itemToMove = prev.find(split => split.id === splitId)?.items.find(item => item.id === itemId);
      if (!itemToMove) return prev;

      return prev.map(split => {
        if (split.id === splitId) {
          // Remove item from current split
          return {
            ...split,
            items: split.items.filter(item => item.id !== itemId)
          };
        } else if (split.id === 'split-1') {
          // Add item to first split
          return {
            ...split,
            items: [...split.items, itemToMove]
          };
        }
        return split;
      });
    });
  };

  const handleSaveSplits = async () => {
    if (!canSave) return;
    if (orderHasPayments(order)) {
      toast.error(t('split.toast.hasPayments'));
      return;
    }

    setIsSaving(true);
    try {
      await assertOrderMutationsAllowed(db);
      const allLines = getOrderFilteredItems(order);
      const newOrders = await commitSplit(db, {
        order,
        user: page?.user,
        parts: actualSplits.map(split => ({
          ...partLines(split.items),
          ratio: linesRatio(split.items, allLines, actualSplits.length),
        })),
      });

      postOrderTracking({
        module: "orders.split_by_items",
        page: page?.page,
        orderId: order.id,
        payload: {
          split_count: newOrders.length,
          new_orders: newOrders.map(String),
        },
        user: page?.user,
      });

      toast.success(t('split.toast.success', {count: newOrders.length}));
      onClose?.();
    } catch (error) {
      console.error('Error creating split orders:', error);
      toast.error(t(splitErrorKey(error)));
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = actualSplits.length > 1 && actualSplits.every(split => split.items.length > 0);

  return (
    <>
      <Modal
        testId="order-split-items"
        title={t('split.title', {invoice: getInvoiceNumber(order)})}
        open={true}
        size="full"
        onClose={onClose}
      >
         <div className="flex flex-col lg:flex-row h-full gap-6 p-4 lg:p-6 bg-gradient-to-br from-gray-50 to-white select-none">
           {/* Left Side - First Split (Fixed) */}
           <div className="w-full max-w-[400px] min-w-0 shrink-0">
             <div className="mb-4">
               <h3 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                 <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                 {t('split.byItems.splitOneFixed')}
               </h3>
               <p className="text-xs text-gray-400 mt-1">
                 {t('split.byItems.mainSplitHint')}
               </p>
               <p className="text-xs text-primary-600 mt-1">{t('split.tapHint')}</p>
             </div>
             {actualSplits.length > 0 && (
               <div
                 className={`bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 ${
                   dragOverSplit === actualSplits[0].id ? 'border-green-400 bg-green-50 scale-105' : ''
                 }`}
                 onDragOver={(e) => handleDragOver(e, actualSplits[0].id)}
                 onDragLeave={handleDragLeave}
                 onDrop={(e) => handleDrop(e, actualSplits[0].id)}
                 {...tap.splitProps(actualSplits[0].id)}
               >
                 <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-green-50 to-transparent">
                   <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                     <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                     {actualSplits[0].name}
                   </h4>
                   <div className="flex items-center gap-2">
                     <span className="text-sm font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                       {t('split.byItems.total', {amount: formatNumber(splitTotals[0])})}
                     </span>
                   </div>
                 </div>
                 <div className="p-4 min-h-[120px] max-h-[calc(100vh-380px)] overflow-y-auto">
                   {actualSplits[0].items.length === 0 ? (
                     <div className="text-center py-6 text-gray-400">
                       <p>{t('split.byItems.noItems')}</p>
                       <p className="text-xs mt-1">{t('split.byItems.itemsReturnHere')}</p>
                     </div>
                   ) : (
                     <div className="space-y-2">
                       {actualSplits[0].items.map(item => (
                         <div
                           key={item.id}
                           className={`p-2 border border-gray-100 rounded-lg bg-gradient-to-r from-gray-50 to-transparent flex justify-between items-center hover:from-green-50 transition-all duration-200 cursor-pointer ${tap.isSelected(item) ? tapSelectedClass : ''}`}
                           draggable
                           onDragStart={(e) => handleDragStart(e, item)}
                           onDragEnd={handleDragEnd}
                         >
                           <div className="flex-1" {...tap.itemProps(item)}>
                             <OrderItemName
                               item={item}
                               showQuantity={true}
                               showPrice={true}
                             />
                           </div>
                           {canCarveUnit(item) && <CarveUnitButton onCarve={() => carveOne(item, actualSplits[0].id)}/>}
                         </div>
                       ))}
                     </div>
                   )}
                 </div>
               </div>
             )}
           </div>

           {/* Right Side - Other Splits (Scrollable) */}
           <div className="flex-1 flex flex-col min-w-0">
             <div className="flex items-center justify-between mb-4 flex-shrink-0">
               <div>
                 <h3 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                   <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                   {t('split.byItems.additionalSplits')}
                 </h3>
                 <p className="text-xs text-gray-400 mt-1">
                   {t('split.byItems.scrollHint')}
                 </p>
               </div>
               <Button
                 variant="success"
                 icon={faPlus}
                 onClick={addSplit}
                 size="lg"
                 className="shadow-lg hover:shadow-green-200"
               >
                 {t('split.byItems.addSplit')}
               </Button>
             </div>

             {/* Scrollable Splits Container */}
             <div className="flex-1 min-h-0">
               {actualSplits.length > 1 ? (
                 <ScrollContainer className="h-full overflow-x-auto overflow-y-auto lg:overflow-y-hidden">
                   <div className="flex flex-col lg:flex-row gap-5 pb-4 h-full">
                     {actualSplits.slice(1).map((split, index) => (
                       <div
                         key={split.id}
                         className={`bg-white rounded-xl shadow-lg border border-gray-200 hover:shadow-xl transition-all duration-300 w-full max-w-[400px] min-w-0 shrink-0 lg:h-full flex flex-col ${
                           dragOverSplit === split.id ? 'border-green-400 bg-green-50 scale-105' : ''
                         }`}
                         onDragOver={(e) => handleDragOver(e, split.id)}
                         onDragLeave={handleDragLeave}
                         onDrop={(e) => handleDrop(e, split.id)}
                         {...tap.splitProps(split.id)}
                       >
                         <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-blue-50 to-transparent flex-shrink-0">
                           <h4 className="font-semibold text-gray-800 flex items-center gap-2">
                             <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                             {split.name}
                           </h4>
                           <div className="flex items-center gap-2">
                             <span className="text-sm font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                               {t('split.byItems.total', {amount: formatNumber(splitTotals[index + 1])})}
                             </span>
                             <IconTooltipButton label={t('split.byItems.moveBackToSplitOne')}
                               variant="danger"
                               icon={faTrash}
                              
                               size="lg"
                               onClick={() => removeSplit(split.id)}
                             />
                           </div>
                         </div>

                         <div className="p-4 flex-1 overflow-y-auto">
                           {split.items.length === 0 ? (
                             <div className="text-center py-6 text-gray-400">
                               <p>{t('split.byItems.noItems')}</p>
                               <p className="text-xs mt-1">{t('split.byItems.dragFromSplitOne')}</p>
                             </div>
                           ) : (
                             <div className="space-y-2">
                               {split.items.map(item => (
                                 <div
                                   key={item.id}
                                   className={`p-2 border border-gray-100 rounded-lg bg-gradient-to-r from-gray-50 to-transparent flex justify-between items-center hover:from-green-50 transition-all duration-200 cursor-pointer ${tap.isSelected(item) ? tapSelectedClass : ''}`}
                                   draggable
                                   onDragStart={(e) => handleDragStart(e, item)}
                                   onDragEnd={handleDragEnd}
                                 >
                                   <div className="flex-1" {...tap.itemProps(item)}>
                                     <OrderItemName
                                       item={item}
                                       showQuantity={true}
                                       showPrice={true}
                                     />
                                   </div>
                                   {canCarveUnit(item) && <CarveUnitButton onCarve={() => carveOne(item, split.id)}/>}
                                   <div>
                                   <Button
                                     variant="danger"
                                     icon={faArrowLeft}
                                    
                                     size="lg"
                                     onClick={() => removeItemFromSplit(item.id, split.id)}
                                     className="ml-2"
                                   />
                                   </div>
                                 </div>
                               ))}
                             </div>
                           )}
                         </div>
                       </div>
                     ))}
                   </div>
                 </ScrollContainer>
               ) : (
                 <div className="flex items-center justify-center h-full text-gray-500">
                   <div className="text-center">
                     <p className="text-lg">{t('split.byItems.noAdditionalSplits')}</p>
                     <p className="text-sm">{t('split.byItems.addSplitHint')}</p>
                   </div>
                 </div>
               )}
             </div>

             {/* Save Button - Fixed at bottom */}
             <div className="pt-4 border-t border-gray-200 mt-4 flex-shrink-0">
               <Button
                 variant="success"
                 icon={faCheck}
                 onClick={handleSaveSplits}
                 disabled={!canSave || isSaving}
                 isLoading={isSaving}
                 size="lg"
                 className="w-full shadow-lg hover:shadow-green-200 transition-all duration-300"
                 filled
               >
                 {isSaving ? t('split.byItems.creating') : t('split.byItems.save', {count: actualSplits.length})}
              </Button>
              {!canSave && (
                <p className="text-sm text-gray-500 mt-2 text-center">
                  {actualSplits.length <= 1
                    ? t('split.byItems.addMoreSplits')
                    : t('split.byItems.allSplitsNeedItems')
                  }
                 </p>
               )}
             </div>
           </div>
         </div>
      </Modal>
    </>
  );
}