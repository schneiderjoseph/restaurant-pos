import { maskIdDocument } from '@/lib/customer-id-document.ts';

export type GuestLike = {
  name?: string | null;
  guest_code?: string | null;
  code?: string | null;
  phone?: number | string | null;
  id_document_number?: string | null;
} | null | undefined;

/**
 * Prefer customer display name; fall back to #CODE when only a guest/room code exists.
 */
export function formatGuestLabel(guest: GuestLike): string {
  if (!guest) return '';
  const name = (guest.name ?? '').trim();
  if (name) return name;
  const code = (guest.guest_code ?? guest.code ?? '').toString().trim();
  if (code) return code.startsWith('#') ? code : `#${code}`;
  return '';
}

/** Phone, else the guest code (#R204), else the masked ID document. Empty when none, or when it repeats the label. */
export function formatGuestContact(guest: GuestLike): string {
  if (!guest) return '';

  const label = formatGuestLabel(guest);

  const phone = guest.phone != null ? String(guest.phone).trim() : '';
  if (phone && phone !== label) {
    return phone;
  }

  const name = (guest.name ?? '').trim();
  if (name) {
    const code = (guest.guest_code ?? guest.code ?? '').toString().trim();
    if (code) {
      const formatted = code.startsWith('#') ? code : `#${code}`;
      if (formatted !== label) {
        return formatted;
      }
    }
  }

  const masked = maskIdDocument(guest.id_document_number);
  if (masked && masked !== label) {
    return masked;
  }

  return '';
}
