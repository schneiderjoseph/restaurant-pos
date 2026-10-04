import { cn } from "@/lib/utils.ts";
import { useAtom } from "jotai";
import { appPage, appSettings, appState, menuSearchAtom } from "@/store/jotai.ts";
import ScrollContainer from 'react-indiana-drag-scroll'
import {CSSProperties, useEffect, useMemo} from "react";
import {resolveMenuAwareData} from "@/lib/menu.resolver.ts";
import {outletsInUse} from "@/lib/outlet-tabs.ts";
import {outletOfCategory} from "@/lib/outlet.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {useTranslation} from "react-i18next";


export const MenuCategories = () => {
  const { t } = useTranslation('menu');
  const [settings] = useAtom(appSettings);
  const [state, setState] = useAtom(appState);
  const [page, setPage] = useAtom(appPage);
  const [, setMenuSearch] = useAtom(menuSearchAtom);

  const {categories: allCategories} = useMemo(() => (
    resolveMenuAwareData({
      categories: settings.categories,
      dishes: settings.dishes,
      menus: settings.menus
    })
  ), [settings.categories, settings.dishes, settings.menus]);

  const outletTabs = useMemo(
    () => outletsInUse(settings.categories ?? []),
    [settings.categories],
  );

  const selectedOutletTab = page.menuConfig?.outletTab;
  const activeOutletId = useMemo(() => {
    if (!selectedOutletTab) return undefined;
    return outletTabs.some((outlet) => recordIdToString(outlet.id) === selectedOutletTab)
      ? selectedOutletTab
      : undefined;
  }, [selectedOutletTab, outletTabs]);

  const categories = useMemo(() => {
    if (!activeOutletId) return allCategories;
    return allCategories.filter((category) =>
      recordIdToString(outletOfCategory(category.id, settings.categories ?? [])?.id) === activeOutletId
    );
  }, [allCategories, activeOutletId, settings.categories]);

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

  const setOutletTab = (outletId?: string) => {
    setMenuSearch('');
    setPage((prev) => ({
      ...prev,
      menuConfig: {
        ...prev.menuConfig,
        outletTab: outletId,
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
          <button
            type="button"
            data-testid="menu-outlet-tab"
            aria-pressed={!activeOutletId}
            className={cn(
              categoryClasses,
              !activeOutletId ? 'bg-gradient' : 'bg-white border-3 border-transparent select-none'
            )}
            onClick={() => setOutletTab(undefined)}
            style={categoryStyles}
          >
            {t('outlets.all')}
          </button>
          {outletTabs.map((outlet) => {
            const outletId = recordIdToString(outlet.id);
            const pressed = activeOutletId === outletId;
            return (
              <button
                key={outletId}
                type="button"
                data-testid="menu-outlet-tab"
                aria-pressed={pressed}
                className={cn(
                  categoryClasses,
                  pressed ? 'bg-gradient' : 'bg-white border-3 border-transparent select-none'
                )}
                onClick={() => setOutletTab(outletId)}
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
