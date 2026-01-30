/**
 * PII Redaction Utilities
 * Prevents logging of sensitive customer data (emails, names, addresses)
 *
 * GDPR/Privacy Compliance:
 * - Email masking: user@example.com → u***@e***.com
 * - Name masking: John Doe → J*** D***
 * - Full object redaction for customer data
 */

/**
 * Redact email address for logging
 * @param {string} email - Email to redact
 * @returns {string} Redacted email (e.g., "u***@e***.com")
 */
export function redactEmail(email) {
  if (!email || typeof email !== 'string') return '[no-email]';

  const [local, domain] = email.split('@');
  if (!domain) return '[invalid-email]';

  const redactedLocal = local.charAt(0) + '***';
  const domainParts = domain.split('.');
  const redactedDomain = domainParts[0].charAt(0) + '***.' + domainParts.slice(1).join('.');

  return `${redactedLocal}@${redactedDomain}`;
}

/**
 * Redact customer name for logging
 * @param {string} name - Name to redact
 * @returns {string} Redacted name (e.g., "J*** D***")
 */
export function redactName(name) {
  if (!name || typeof name !== 'string') return '[no-name]';

  const parts = name.trim().split(/\s+/);
  return parts.map(part => part.charAt(0) + '***').join(' ');
}

/**
 * Redact customer object for safe logging
 * @param {object} customer - Customer object
 * @returns {object} Redacted customer data
 */
export function redactCustomer(customer) {
  if (!customer) return null;

  return {
    id: customer.id || '[no-id]',
    email: redactEmail(customer.email),
    name: customer.name ? redactName(customer.name) : '[no-name]',
    // Never log: phone, address, postal_code, etc.
  };
}

/**
 * Redact order object for safe logging
 * @param {object} order - Order object
 * @returns {object} Redacted order data
 */
export function redactOrder(order) {
  if (!order) return null;

  return {
    orderId: order.order_id || order.id || '[no-id]',
    email: redactEmail(order.customer_email || order.email),
    status: order.status,
    totalPrice: order.total_price,
    // Never log: full customer data, shipping address
  };
}

/**
 * Redact booking object for safe logging
 * @param {object} booking - Booking object
 * @returns {object} Redacted booking data
 */
export function redactBooking(booking) {
  if (!booking) return null;

  return {
    bookingId: booking.booking_id || booking.id,
    email: redactEmail(booking.customer_email || booking.customerEmail),
    eventDate: booking.event_date || booking.eventDate,
    status: booking.status,
    // Never log: customer name, phone, address
  };
}
