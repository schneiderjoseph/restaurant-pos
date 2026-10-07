import {PropsWithChildren, useEffect, useState} from "react";
import {useDB} from "@/api/db/db.ts";
import {ensureRestaurantProfileLoaded} from "@/lib/restaurant-profile.ts";
import {Sidebar} from "@/screens/partials/sidebar.tsx";
import {cn} from "@/lib/utils.ts";
import {useIsNarrow} from "@/hooks/useBreakpoint.ts";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faBars, faTimes} from "@fortawesome/free-solid-svg-icons";
import {useTranslation} from "react-i18next";
import {useLocation} from "react-router";

interface Props extends PropsWithChildren {
  gap?: boolean
  overflowHidden?: boolean
  containerClassName?: string
  showSidebar?: boolean
}

export const Layout = ({
  showSidebar = true, ...props
}: Props) => {
  const db = useDB();
  const isNarrow = useIsNarrow();
  const {t} = useTranslation('common');
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    // Keeps this device's copy of the logo fresh for the login page.
    ensureRestaurantProfileLoaded(db);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; db identity changes every render
  }, []);

  // Close mobile drawer on navigation.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const railSidebar = showSidebar && !isNarrow;
  const drawerSidebar = showSidebar && isNarrow;

  return (
    <div className={
      cn(
        "h-[100dvh] max-h-[100dvh]",
        props.overflowHidden ? 'overflow-hidden' : 'overflow-auto'
      )
    }>
      <div className={cn("flex h-full min-h-0", drawerSidebar && "flex-col")}>
        {railSidebar && (
          <div className="flex-grow-0 flex-shrink-0 w-[130px] h-full">
            <Sidebar/>
          </div>
        )}

        {drawerSidebar && (
          <div
            className="flex shrink-0 items-center gap-2 px-3 py-2 border-b border-white/60 bg-white/50 backdrop-blur safe-area-top"
            data-testid="mobile-nav-bar"
          >
            <button
              type="button"
              className="btn btn-primary btn-square lg"
              aria-label={t('actions.back')}
              data-testid="mobile-nav-toggle"
              onClick={() => setNavOpen(true)}
            >
              <FontAwesomeIcon icon={faBars}/>
            </button>
          </div>
        )}

        {drawerSidebar && navOpen && (
          <div className="fixed inset-0 z-[900]" data-testid="mobile-nav-drawer">
            <button
              type="button"
              className="absolute inset-0 bg-black/40 border-0"
              aria-label={t('actions.close')}
              onClick={() => setNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-[min(280px,85vw)] bg-white shadow-2xl safe-area-left flex flex-col">
              <div className="flex justify-end p-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-flat btn-square lg"
                  aria-label={t('actions.close')}
                  onClick={() => setNavOpen(false)}
                >
                  <FontAwesomeIcon icon={faTimes}/>
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <Sidebar variant="drawer" onNavigate={() => setNavOpen(false)}/>
              </div>
            </div>
          </div>
        )}

        <div className={
          cn(
            "flex-auto overflow-auto min-h-0 min-w-0 max-h-[100dvh]",
            props.containerClassName
          )
        }>
          {props.children}
        </div>
      </div>
    </div>
  );
}
