import { ReactNode, useRef, useState } from "react";
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/common/input/button.tsx";
import {
  faPrint,
  faFile,
  faRefresh,
  faChevronLeft,
  faChevronRight, faImage,
} from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils.ts";
import {
  exportElementAsImage,
  exportElementAsPdf,
  printDocument,
} from "@/lib/export.document.ts";
import { DateTime } from "luxon";
import { DocumentTitle } from "@/components/common/document-title.tsx";
import { useCurrencyDisplay } from "@/hooks/useCurrencyDisplay.ts";
import { getExchangeRateLabel } from "@/lib/currency.ts";
import { useRestaurantProfile } from "@/hooks/useRestaurantProfile.ts";
import { sanitizeReportFilename } from "@/lib/report.branding.ts";
import { getAppLocale } from "@/lib/currency.ts";
import {
  buildReportWorkbook,
  downloadWorkbook,
  extractReportSections,
} from "@/lib/report.excel.ts";

export interface ReportsLayoutProps {
  /** Report title */
  title: string;
  /** Subtitle, typically for date range */
  subtitle?: string;
  /** Restaurant name */
  restaurantName?: string;
  /** Restaurant address */
  restaurantAddress?: string;
  /** Report content */
  children: ReactNode;
  /** Optional pagination props */
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
  /** Custom action buttons */
  customActions?: ReactNode;
  /** Callback for print action */
  onPrint?: () => void;
  /** Callback for Excel export */
  onExportExcel?: () => void;
  /** Callback for PDF export */
  onExportPdf?: () => void;
  /** Callback for PDF export */
  onExportImage?: () => void;
  /** Callback for refresh action */
  onRefresh?: () => void;
  /** Additional className for the container */
  className?: string;
}

export const ReportsLayout = ({
  title,
  subtitle,
  restaurantName,
  restaurantAddress,
  children,
  pagination,
  customActions,
  onPrint,
  onExportExcel,
  onExportPdf,
  onExportImage,
  onRefresh,
  className,
}: ReportsLayoutProps) => {
  const { t } = useTranslation('reports');
  const { t: tNav } = useTranslation('navigation');
  useCurrencyDisplay();
  const { profile, logoDataUrl } = useRestaurantProfile();
  const displayName = restaurantName ?? profile.name;
  const displayAddress = restaurantAddress ?? profile.address;
  const displayPhone = profile.phone;
  const displayEmail = profile.email;
  const exchangeRateLabel = getExchangeRateLabel();
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [generatedAt] = useState(DateTime.now().toFormat(import.meta.env.VITE_DATE_TIME_FORMAT));

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      printDocument();
    }
  };

  const handleExportExcel = async () => {
    if (onExportExcel) {
      onExportExcel();
      return;
    }

    if (!reportRef.current || exporting) return;
    setExporting(true);
    try {
      const sections = extractReportSections(reportRef.current, getAppLocale(), title);
      if (sections.length === 0) return;
      const wb = await buildReportWorkbook({
        branding: {
          title,
          subtitle,
          generatedAt: `${t('layout.generatedAt')} ${generatedAt}`,
          profile: {
            name: displayName,
            address: displayAddress,
            phone: displayPhone,
            email: displayEmail,
            website: profile.website,
            taxId: profile.taxId,
          },
        },
        sections,
        logoDataUrl,
        sheetName: title,
        decimals: Number(import.meta.env.VITE_DECIMAL_PLACES ?? 2) || 0,
        exchangeRateLabel: exchangeRateLabel ? t('layout.dualCurrency', { rate: exchangeRateLabel }) : null,
      });
      await downloadWorkbook(wb, sanitizeReportFilename(title || "report", "xlsx"));
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (onExportPdf) {
      onExportPdf();
    } else {
      const file = sanitizeReportFilename(title || "report", "pdf");
      await exportElementAsPdf(reportRef.current, file, {
        watermarkDataUrl: logoDataUrl,
        watermarkText: displayName || title,
      });
    }
  };

  const handleExportImage = async () => {
    if (onExportImage) {
      onExportImage();
    } else {
      await exportElementAsImage(
        reportRef.current,
        sanitizeReportFilename(title || "report", "png"),
      );
    }
  };

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      window.location.reload();
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <DocumentTitle parts={[title, tNav('sidebar.reports')]} />
      <div className="flex items-center justify-between gap-3 p-4 bg-white shadow-sm border-b print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={handlePrint} icon={faPrint} size="sm">
            {t('layout.print')}
          </Button>
          <Button variant="primary" onClick={handleExportExcel} icon={faFile} size="sm" disabled={exporting}>
            {t('layout.downloadXlsx')}
          </Button>
          <Button variant="primary" onClick={handleExportPdf} icon={faFile} size="sm">
            {t('layout.downloadPdf')}
          </Button>
          <Button variant="primary" onClick={handleExportImage} icon={faImage} size="sm">
            {t('layout.downloadImage')}
          </Button>
          <Button variant="primary" onClick={handleRefresh} icon={faRefresh} size="sm">
            {t('layout.refresh')}
          </Button>
          {customActions}
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 relative" ref={reportRef}>
        {logoDataUrl && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            style={{ zIndex: 0 }}
          >
            <img
              src={logoDataUrl}
              alt=""
              className="max-h-[55%] max-w-[55%] object-contain opacity-[0.06] select-none"
            />
          </div>
        )}
        <div className="max-w-full relative" style={{ zIndex: 1 }}>
          <div className="bg-white/95 shadow-sm rounded-lg p-3 mb-3 print:shadow-none text-center">
            {logoDataUrl && (
              <img
                src={logoDataUrl}
                alt=""
                className="mx-auto mb-2 max-h-16 max-w-[220px] object-contain"
              />
            )}
            <h1 className="text-3xl font-bold mb-1">{title}</h1>
            {subtitle && (
              <p className="text-lg text-gray-600 mb-1">{subtitle}</p>
            )}
            <div className="space-y-[3px] text-sm text-gray-700">
              {displayName && (
                <p className="font-semibold">{displayName}</p>
              )}
              {displayAddress && (
                <p className="whitespace-pre-line">{displayAddress}</p>
              )}
              {(displayPhone || displayEmail) && (
                <p>{[displayPhone, displayEmail].filter(Boolean).join(' · ')}</p>
              )}
              {profile.website && <p>{profile.website}</p>}
              {profile.taxId && <p>{profile.taxId}</p>}
              <p className="text-gray-500 mt-2">
                {t('layout.generatedAt')} {generatedAt}
              </p>
              {exchangeRateLabel && (
                <p className="text-gray-500">
                  {t('layout.dualCurrency', { rate: exchangeRateLabel })}
                </p>
              )}
            </div>
          </div>

          <div className="bg-white/95 shadow-sm rounded-lg p-6 print:shadow-none">
            {children}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div
              data-pdf-ignore
              className="flex items-center justify-center gap-2 mt-6 bg-white shadow-sm rounded-lg p-4 print:hidden"
            >
              <Button
                variant="primary"
                onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                disabled={pagination.currentPage === 1}
                icon={faChevronLeft}
                size="sm"
              >
                Previous
              </Button>
              <span className="text-sm text-gray-700 px-4">
                Page {pagination.currentPage} of {pagination.totalPages}
              </span>
              <Button
                variant="primary"
                onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
                disabled={pagination.currentPage === pagination.totalPages}
                rightIcon={faChevronRight}
                size="sm"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

