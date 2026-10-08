import type {ReactNode} from "react";

const receiptLinkClass = "text-primary-700 underline font-medium";

export const ReceiptMarkdownLink = ({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={receiptLinkClass}
  >
    {children}
  </a>
);
