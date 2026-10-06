import { cn } from "@/lib/utils.ts";
import { useAtom } from "jotai";
import { appPage, appSettings, appState, menuSearchAtom } from "@/store/jotai.ts";
import ScrollContainer from 'react-indiana-drag-scroll'
import {CSSProperties, useEffect, useMemo} from "react";
import {resolveMenuAwareData} from "@/lib/menu.resolver.ts";
import {outletsInUse} from "@/lib/outlet-tabs.ts";
import {outletOfCategory} from "@/lib/outlet.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {menuCategoriesFor} from "@/lib/menu-categories.ts";


export const MenuCategories = () => {
  const [settings] = useAtom(appSettings);
  const [state, setState] = useAtom(appState);
  const [page, setPage] = useAtom(appPage);
  const [, setMenuSearch] = useAtom(menuSearchAtom);

  const {categories: allCategories} = useMemo(() => (
    resolveMenuAwareData({
      categories: menuCategoriesFor(settings.categories, state.table),
      dishes: settings.dishes,
      menus: settings.menus
    })
  ), [settings.categories, settings.dishes, settings.menus, state.table]);

  const outletTabs = useMemo(
    () => outletsInUse(settings.categories ?? []),
    [settings.categories],
  );

  // Selected points of sale, minus any that no longer have a category.
  const selectedOutletTabs = page.menuConfig?.outletTabs;
  const activeOutletIds = useMemo(() => {
    const inUse = new Set(outletTabs.map((outlet) => recordIdToString(outlet.id)));
    return new Set((selectedOutletTabs ?? []).filter((id) => inUse.has(id)));
  }, [selectedOutletTabs, outletTabs]);

  const categories = useMemo(() => {
    if (activeOutletIds.size === 0) return allCategories;
    return allCategories.filter((category) =>
      activeOutletIds.has(recordIdToString(outletOfCategory(category.id, settings.categories ?? [])?.id))
    );
  }, [allCategories, activeOutletIds, settings.categories]);

  useEffect(() => {
    const currentCategoryExists = categories.some(
      category => category.id?.toString() === state.category?.id?.toString()
    );

    if (categories.length > 0 && (!state.category || !currentCategoryExists)) {
      setState(prev => ({
        ...prev,
        category: categories[0]
      }));
      return;
    }

    if (categories.length === 0 && state.category) {
      setState(prev => ({
        ...prev,
        category: undefined
      }));
    }
  }, [categories, state.category]);

  // Each point of sale toggles on its own; several can be on at once.
  const toggleOutletTab = (outletId: string) => {
    setMenuSearch('');
    const next = new Set(activeOutletIds);
    if (next.has(outletId)) {
      next.delete(outletId);
    } else {
      next.add(outletId);
    }
    setPage((prev) => ({
      ...prev,
      menuConfig: {
        ...prev.menuConfig,
        outletTab: undefined,
        outletTabs: [...next],
      },
    }));
  };

  const categoryClasses = 'flex-auto whitespace-nowrap !h-[56px] pressable rounded-full px-5';
  const categoryStyles = {
    '--padding': '0 1.25rem'
  } as CSSProperties;

  return (
    <div data-testid="menu-categories">
      {outletTabs.length > 0 && (
        <ScrollContainer className="flex flex-row gap-1 p-1 pb-0" mouseScroll>
          {outletTabs.map((outlet) => {
            const outletId = recordIdToString(outlet.id);
            const pressed = activeOutletIds.has(outletId);
            return (
              <button
                key={outletId}
                type="button"
                data-testid="menu-outlet-tab"
                aria-pressed={pressed}
                className={cn(
                  categoryClasses,
                  pressed ? '!bg-black !text-white border-3 border-black' : 'bg-white border-3 border-transparent select-none'
                )}
                onClick={() => toggleOutletTab(outletId)}
                style={categoryStyles}
              >
                {outlet.name}
              </button>
            );
          })}
        </ScrollContainer>
      )}
      <ScrollContainer className="flex flex-row gap-1 p-1" mouseScroll>
        {categories.map((item, index) => (
          <button
            key={index}
            type="button"
            data-testid={`menu-category-${index}`}
            className={cn(
              categoryClasses,
              state?.category?.id?.toString() === item?.id?.toString() ? 'bg-gradient' : 'bg-white border-3 border-transparent select-none'
            )}
            onClick={() => {
              setMenuSearch('');
              setState(prev => ({
                ...prev,
                category: item
              }));
            }}
            style={categoryStyles}
          >
            {item.name}
          </button>
        ))}
      </ScrollContainer>
    </div>
  )
}
