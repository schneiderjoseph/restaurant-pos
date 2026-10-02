# Security re-authentication

You only see the modules, tabs and buttons your role allows; everything else is hidden. A few in-service actions stay visible to everyone and ask a manager to approve on the spot with PIN or QR: cancelling an order, discounts and coupons, refunds, opening the cash drawer, and reprints.

### When re-auth appears

1. You attempt one of those in-service actions without the permission, or an action that always requires approval.
2. A modal opens with a short description of what is being approved.
3. Session security settings (idle lock) are separate — that locks the terminal; this modal approves one action.

![Session security settings (related but separate from action re-auth).](images/en/security-session-card.png)

*Session security settings (related but separate from action re-auth).*

### Approval modal

1. Read the action description in the modal title.
2. Choose PIN or QR when both methods are available.
3. Complete authentication to continue, or cancel to abort the action.

![Manager approval (security) modal.](images/en/security-modal.png)

*Manager approval (security) modal.*

### Auth method buttons

Venues can allow more than one manager auth method.

1. Tap PIN for the numeric pad.
2. Tap QR when a scanned manager badge is supported.

![PIN / QR method selector.](images/en/security-auth-types.png)

*PIN / QR method selector.*

### PIN entry

1. Enter the approving manager's 4-digit PIN on the pad.
2. Dots fill as digits are entered; validation runs when four digits are complete.
3. Invalid PIN shows an error — clear and try again, or cancel.

![Security PIN pad.](images/en/security-pin-pad.png)

*Security PIN pad.*
