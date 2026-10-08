import {Swiper, SwiperSlide} from "@/components/common/swiper/lazy-swiper.tsx";
import type {Swiper as SwiperInstance} from "swiper";
import {cn} from "@/lib/utils.ts";
import {useAtom} from "jotai";
import {
  appSettings,
  appState,
  closingEnforcementAtom,
  menuSearchAtom,
} from "@/store/jotai.ts";
import {useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {useMediaQuery} from "react-responsive";
import {useIsPhone} from "@/hooks/useBreakpoint.ts";
import {MenuDish} from "@/components/menu/dish.tsx";
import {CartModifierGroup, MenuItem} from "@/api/model/cart_item.ts";
import {resolveMenuAwareData} from "@/lib/menu.resolver.ts";
import {mergeCartItem} from "@/lib/cart.ts";
import {searchDishes} from "@/lib/menu-search.ts";
import {toast} from "sonner";
import i18n from "@/lib/i18n.ts";
import {useTranslation} from "react-i18next";
import {faTimes} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {Input} from "@/components/common/input/input.tsx";
import {MenuCategories} from "@/components/menu/categories.tsx";
import ScrollContainer from "react-indiana-drag-scroll";

export const MenuDishes = () => {
  const {t} = useTranslation('menu');
  const isPhone = useIsPhone();
  const isTablet = useMediaQuery({maxWidth: 1024});
  const [activeSlide, setActiveSlide] = useState(0);
  const swiperRef = useRef<SwiperInstance | null>(null);

  const [state, setState] = useAtom(appState);
  const [settings] = useAtom(appSettings);
  const [enforcement] = useAtom(closingEnforcementAtom);
  const [menuSearch, setMenuSearch] = useAtom(menuSearchAtom);
  const orderTakingBlocked = enforcement.orderTakingBlocked;
  const headerQuery = menuSearch.trim();
  const hasHeaderSearch = headerQuery.length > 0;

  const ITEMS_PER_SLIDE = useMemo(() => {
    if (isPhone) return 8;
    if (isTablet) return 15;
    return 20;
  }, [isPhone, isTablet]);

  const {dishes: allDishes} = useMemo(() => (
    resolveMenuAwareData({
      categories: settings.categories,
      dishes: settings.dishes,
      menus: settings.menus
    })
  ), [settings.categories, settings.dishes, settings.menus]);

  const categoryDishes = useMemo(() => {
    if (state.category) {
      return allDishes?.filter(item =>
        (item.categories ?? []).filter(cat => cat.id.toString() === state?.category?.id.toString()).length > 0
      ) || [];
    }

    return allDishes || [];
  }, [allDishes, state.category]);

  const dishes = useMemo(() => {
    if (hasHeaderSearch) {
      return searchDishes(allDishes || [], menuSearch);
    }
    return categoryDishes;
  }, [hasHeaderSearch, menuSearch, allDishes, categoryDishes]);

  const slides = Math.ceil((dishes?.length || 0) / ITEMS_PER_SLIDE) || 1;
  const categoryId = state.category?.id?.toString();
  const headerSearchEmpty = hasHeaderSearch && (dishes?.length || 0) === 0;

  useEffect(() => {
    setActiveSlide(0);
    swiperRef.current?.slideTo(0, 0);
  }, [categoryId, menuSearch, slides]);

  const onClick = (item: MenuItem, selectedGroups?: CartModifierGroup[]) => {
    if (orderTakingBlocked) {
      toast.warning(enforcement.message ?? i18n.t('closing:orderTakingDisabled'));
      return;
    }

    const mergeWithOld =
      state.order?.id != null && String(state.order.id) !== 'new';

    // A dish found by search may not belong to the selected category: the line must carry
    // the dish's own category, which also decides the point of sale it is sold under.
    const ownCategories = item.dish?.categories ?? [];
    const inSelectedCategory = ownCategories.some(
      category => category.id?.toString() === state.category?.id?.toString()
    );
    if (!inSelectedCategory && ownCategories.length > 0) {
      item = {
        ...item,
        category: ownCategories[0].name,
        category_id: ownCategories[0].id?.toString(),
      };
    }

    setState(prev => ({
      ...prev,
      cart: mergeCartItem(
        prev.cart,
        {
          ...item,
          selectedGroups,
        },
        { mergeWithOld },
      ),
    }));
  };

  const onKeyboardResultClick = (item: MenuItem, selectedGroups?: CartModifierGroup[]) => {
    onClick(item, selectedGroups);
    setMenuSearch('');
  };

  const keyboardResults = useMemo(() => {
    if (!hasHeaderSearch) {
      return [];
    }
    return searchDishes(allDishes || [], menuSearch).slice(0, 12);
  }, [hasHeaderSearch, allDishes, menuSearch]);

  const keyboardHeader: ReactNode = (
    <div
      className="h-[76px] pr-12"
      data-testid="menu-search-keyboard-results"
    >
      {!hasHeaderSearch ? null : keyboardResults.length === 0 ? (
        <div className="flex h-full items-center text-neutral-500">
          {t('search.noResults')}
        </div>
      ) : (
        <ScrollContainer className="flex h-full flex-nowrap gap-2" mouseScroll>
          {keyboardResults.map((item) => (
            <div
              key={item.id?.toString() ?? item.number}
              className="flex w-[180px] shrink-0"
            >
              <MenuDish
                onClick={onKeyboardResultClick}
                item={item}
                level={0}
                price={item.price}
              />
            </div>
          ))}
        </ScrollContainer>
      )}
    </div>
  );

  useEffect(() => {
    return () => {
      setMenuSearch('');
      setState(prev => ({
        ...prev,
        category: undefined
      }));
    };
  }, [setMenuSearch, setState]);

  const dishGrid = (
    <div className="relative min-h-0 h-full">
      <Swiper
        slidesPerView={1}
        className={cn(
          "dishes-swiper",
          orderTakingBlocked && "opacity-50 pointer-events-none"
        )}
        direction="vertical"
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
        }}
        onSlideChange={(swiper) => {
          setActiveSlide(swiper.activeIndex);
        }}
      >
        {Array.from({length: slides}, (_, i) => i).map(rowId => (
          <SwiperSlide
            key={rowId}
            className="!grid grid-cols-2 grid-rows-4 sm:grid-cols-3 sm:grid-rows-5 md:grid-cols-4 md:grid-rows-5"
          >
            {dishes.slice(rowId * ITEMS_PER_SLIDE, ((rowId * ITEMS_PER_SLIDE) + ITEMS_PER_SLIDE)).map((item) => (
              <MenuDish
                onClick={onClick}
                item={item}
                key={item.id?.toString() ?? item.number}
                level={0}
                price={item.price}
              />
            ))}
          </SwiperSlide>
        ))}
      </Swiper>

      {slides > 1 && (
        <div
          className={cn(
            "absolute right-1 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5",
            orderTakingBlocked && "pointer-events-none opacity-50"
          )}
        >
          {Array.from({length: slides}, (_, i) => i).map((index) => (
            <button
              key={index}
              type="button"
              aria-label={t('dishes.slideOf', { current: index + 1, total: slides })}
              aria-current={activeSlide === index ? "true" : undefined}
              onClick={() => swiperRef.current?.slideTo(index)}
              className={cn(
                "rounded-full transition-all",
                activeSlide === index
                  ? "h-2.5 w-2.5 bg-warning-500"
                  : "h-1.5 w-1.5 bg-neutral-400 hover:bg-neutral-500"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );

  const dishesArea = headerSearchEmpty ? (
    <div
      className="flex h-full min-h-0 flex-1 items-center justify-center text-neutral-500"
      data-testid="menu-search-empty"
    >
      {t('search.noResults')}
    </div>
  ) : (
    dishGrid
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="menu-dishes-panel">
      <div className="relative mb-3 shrink-0">
        <Input
          inputSize="lg"
          className="search-field w-full pr-12 h-12 min-h-[48px]"
          placeholder={t('search.placeholderBoth')}
          value={menuSearch}
          onChange={(event) => setMenuSearch(event.target.value)}
          data-testid="menu-search"
          hideKeyboardTitle
          keyboardHeader={keyboardHeader}
        />
        {hasHeaderSearch && (
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 btn btn-primary btn-flat lg btn-square"
            onClick={() => setMenuSearch('')}
            aria-label={t('header.clear')}
            title={t('header.clear')}
            data-testid="menu-search-clear"
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        )}
      </div>
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 rounded-xl">
          <MenuCategories/>
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-xl">
        {dishesArea}
      </div>
    </div>
  );
};
