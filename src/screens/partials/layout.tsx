import { PropsWithChildren, useEffect } from "react";
import { useDB } from "@/api/db/db.ts";
import { ensureRestaurantProfileLoaded } from "@/lib/restaurant-profile.ts";
import { Sidebar } from "@/screens/partials/sidebar.tsx";
import { cn } from "@/lib/utils.ts";

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
  useEffect(() => {
    // Keeps this device's copy of the logo fresh for the login page.
    ensureRestaurantProfileLoaded(db);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; db identity changes every render
  }, []);

  return (
    <div className={
      cn(
        "max-h-[100vh] h-[100vh] print:max-h-none print:h-auto print:overflow-visible",
        props.overflowHidden ? 'overflow-hidden' : 'overflow-auto'
      )
    }>
      <div className="flex h-full min-h-0 print:block print:h-auto">
        {showSidebar && (
          <div className="flex-grow-0 flex-shrink-0 w-[130px] print:hidden">
            <Sidebar/>
          </div>
        )}

        <div className={
          cn(
            "flex-auto overflow-auto max-h-[100vh] min-h-0 print:max-h-none print:overflow-visible", props.containerClassName
          )
        }>
          {props.children}
        </div>
      </div>
    </div>
  );
}
