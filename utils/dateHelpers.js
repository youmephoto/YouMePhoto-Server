import {
  addDays,
  subDays,
  eachDayOfInterval,
  format,
  parseISO,
  isAfter,
  isBefore,
  isEqual,
} from 'date-fns';

/**
 * Berechnet geblockte Daten für ein Event basierend auf Buffer-Zeiten
 * WICHTIG: Inkludiert Chain-Buffer - am Ende werden nochmal bufferBefore Tage angehängt,
 * damit nachfolgende Buchungen auch Buffer haben können
 *
 * @param {string|Date} eventDate - Das Event-Datum
 * @param {number} bufferBefore - Anzahl Tage vor dem Event (für Versand)
 * @param {number} bufferAfter - Anzahl Tage nach dem Event (für Rückversand)
 * @returns {string[]} Array von Datumsstrings im Format 'yyyy-MM-dd'
 *
 * @example
 * // Event am 15.01.2024, bufferBefore=2, bufferAfter=4
 * // Direkt blockiert: 13.01 - 19.01 (2 vor + Event + 4 nach)
 * // Chain-Buffer: 20.01 - 21.01 (nochmal 2 Tage, damit neue Buchungen Buffer haben)
 * // Geblockte Tage: 13.01 - 21.01 (9 Tage total)
 * calculateBlockedDates('2024-01-15', 2, 4)
 * // Returns: ['2024-01-13', '2024-01-14', '2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19', '2024-01-20', '2024-01-21']
 */
export function calculateBlockedDates(eventDate, bufferBefore = 2, bufferAfter = 2) {
  const date = typeof eventDate === 'string' ? parseISO(eventDate) : eventDate;

  const start = subDays(date, bufferBefore);
  // Chain-Buffer: Am Ende nochmal bufferBefore Tage anhängen
  // Damit nachfolgende Buchungen genug Platz für ihren BUFFER_BEFORE haben
  const end = addDays(date, bufferAfter + bufferBefore);

  const days = eachDayOfInterval({ start, end });

  return days.map(day => format(day, 'yyyy-MM-dd'));
}

/**
 * Berechnet geblockte Daten für eine Buchung mit Start- und Enddatum
 * Berücksichtigt Buffer vor dem Start und nach dem Ende
 * WICHTIG: Inkludiert Chain-Buffer - am Ende werden nochmal bufferBefore Tage angehängt
 *
 * @param {string|Date} startDate - Startdatum der Buchung
 * @param {string|Date} endDate - Enddatum der Buchung
 * @param {number} bufferBefore - Anzahl Tage vor dem Start (für Versand)
 * @param {number} bufferAfter - Anzahl Tage nach dem Ende (für Rückversand)
 * @returns {string[]} Array von Datumsstrings im Format 'yyyy-MM-dd'
 *
 * @example
 * // Buchung vom 15.12. - 18.12.2024, bufferBefore=2, bufferAfter=2
 * // Direkt blockiert: 13.12 - 20.12 (2 vor + Events + 2 nach)
 * // Chain-Buffer: 21.12 - 22.12 (nochmal 2 Tage)
 * // Geblockte Tage: 13.12. - 22.12. (10 Tage total)
 * calculateBlockedDatesForRange('2024-12-15', '2024-12-18', 2, 2)
 * // Returns: ['2024-12-13', '2024-12-14', '2024-12-15', '2024-12-16', '2024-12-17', '2024-12-18', '2024-12-19', '2024-12-20', '2024-12-21', '2024-12-22']
 */
export function calculateBlockedDatesForRange(startDate, endDate, bufferBefore = 2, bufferAfter = 2) {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;

  const blockedStart = subDays(start, bufferBefore);
  // Chain-Buffer: Am Ende nochmal bufferBefore Tage anhängen
  const blockedEnd = addDays(end, bufferAfter + bufferBefore);

  const days = eachDayOfInterval({ start: blockedStart, end: blockedEnd });

  return days.map(day => format(day, 'yyyy-MM-dd'));
}

/**
 * Prüft ob zwei Datumsbereiche sich überlappen
 *
 * @param {string[]} range1 - Erster Datumsbereich (Array von Datumsstrings)
 * @param {string[]} range2 - Zweiter Datumsbereich (Array von Datumsstrings)
 * @returns {boolean} True wenn sich die Bereiche überlappen
 *
 * @example
 * const booking1 = ['2024-12-13', '2024-12-14', '2024-12-15'];
 * const booking2 = ['2024-12-15', '2024-12-16', '2024-12-17'];
 * datesOverlap(booking1, booking2) // Returns: true (15.12. ist in beiden)
 */
export function datesOverlap(range1, range2) {
  return range1.some(date => range2.includes(date));
}

/**
 * Generiert Array von Daten zwischen Start und End
 *
 * @param {string|Date} startDate - Startdatum
 * @param {string|Date} endDate - Enddatum
 * @returns {string[]} Array von Datumsstrings
 *
 * @example
 * getDateRange('2024-12-01', '2024-12-05')
 * // Returns: ['2024-12-01', '2024-12-02', '2024-12-03', '2024-12-04', '2024-12-05']
 */
export function getDateRange(startDate, endDate) {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;

  const days = eachDayOfInterval({ start, end });

  return days.map(day => format(day, 'yyyy-MM-dd'));
}

/**
 * Formatiert Datum zu yyyy-MM-dd String
 *
 * @param {string|Date} date - Zu formatierendes Datum
 * @returns {string} Datumsstring im Format 'yyyy-MM-dd'
 */
export function formatDate(date) {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'yyyy-MM-dd');
}

/**
 * Prüft ob ein Datum in der Zukunft liegt
 *
 * @param {string|Date} date - Zu prüfendes Datum
 * @returns {boolean} True wenn Datum in der Zukunft
 */
export function isInFuture(date) {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isAfter(d, new Date());
}

/**
 * Prüft ob ein Datum innerhalb eines Zeitraums liegt
 *
 * @param {string|Date} date - Zu prüfendes Datum
 * @param {string|Date} startDate - Start des Zeitraums
 * @param {string|Date} endDate - Ende des Zeitraums
 * @returns {boolean} True wenn Datum im Zeitraum
 */
export function isDateInRange(date, startDate, endDate) {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;

  return (isAfter(d, start) || isEqual(d, start)) &&
         (isBefore(d, end) || isEqual(d, end));
}

/**
 * Berechnet Ablaufzeit für Reservierung
 *
 * @param {number} hours - Anzahl Stunden bis Ablauf
 * @returns {string} ISO String der Ablaufzeit
 *
 * @example
 * getReservationExpiry(3)
 * // Returns: '2024-11-30T21:05:00.000Z' (aktuelle Zeit + 3 Stunden)
 */
export function getReservationExpiry(hours = 3) {
  const now = new Date();
  const expiry = new Date(now.getTime() + hours * 60 * 60 * 1000);
  return expiry.toISOString();
}

/**
 * Prüft ob eine Reservierung abgelaufen ist
 *
 * @param {string|Date} expiryDate - Ablaufdatum der Reservierung
 * @returns {boolean} True wenn abgelaufen
 */
export function isReservationExpired(expiryDate) {
  const expiry = typeof expiryDate === 'string' ? parseISO(expiryDate) : expiryDate;
  return isBefore(expiry, new Date());
}
