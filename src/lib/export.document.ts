import html2canvas from "html2canvas";
import { exportElementAsRealPdf } from "@/lib/export.pdf.ts";

export const printDocument = () => {
  window.print();
};

/** Text/vector PDF (tables + headings). Charts are snapshotted only as images. */
export const exportElementAsPdf = async (
  element: HTMLElement | null,
  filename = "document.pdf",
) => {
  await exportElementAsRealPdf(element, filename);
};

export const exportElementAsImage = async (
  element: HTMLElement | null,
  filename = "document.png",
) => {
  if (!element) return;

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    scrollY: -window.scrollY,
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
};
