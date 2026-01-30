import nodemailer from 'nodemailer';
import { format, parseISO } from 'date-fns';
import de from 'date-fns/locale/de/index.js';

/**
 * Email Service
 *
 * Verantwortlich für:
 * - Email-Benachrichtigungen bei Reservierungen
 * - Bestätigungs-Emails nach Zahlung
 * - Erinnerungen und Updates
 */

let transporter = null;

/**
 * Initialisiert Email-Transporter
 */
function getTransporter() {
  if (!transporter) {
    // Check if SMTP credentials are configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('[EmailService] ERROR: SMTP credentials not configured!');
      console.error('[EmailService] Missing environment variables:');
      if (!process.env.SMTP_HOST) console.error('  - SMTP_HOST');
      if (!process.env.SMTP_USER) console.error('  - SMTP_USER');
      if (!process.env.SMTP_PASS) console.error('  - SMTP_PASS');
      console.error('[EmailService] Please set these in Railway environment variables');
      throw new Error('SMTP credentials not configured');
    }

    console.log(`[EmailService] Configuring SMTP: ${process.env.SMTP_USER}@${process.env.SMTP_HOST}:${process.env.SMTP_PORT || '587'}`);

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Sendet Reservierungs-Email
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Reservierungsdaten
 * @returns {Promise<boolean>} Success status
 */
export async function sendReservationEmail(email, data) {
  try {
    const { bookingId, eventDate, productTitle, reservedUntil } = data;

    const formattedDate = format(parseISO(eventDate), 'dd. MMMM yyyy', {
      locale: de,
    });

    const formattedExpiry = format(parseISO(reservedUntil), 'dd.MM.yyyy HH:mm', {
      locale: de,
    });

    const bookingLink = `${process.env.SHOP_URL}/pages/booking?id=${bookingId}`;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Fotobox Reservierung - ${productTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Ihre Fotobox ist reserviert! 📸</h2>

          <p>Vielen Dank für Ihre Reservierung!</p>

          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Reservierungs-Details:</h3>
            <p><strong>Produkt:</strong> ${productTitle}</p>
            <p><strong>Event-Datum:</strong> ${formattedDate}</p>
            <p><strong>Reservierungs-ID:</strong> ${bookingId}</p>
            <p><strong>Reserviert bis:</strong> ${formattedExpiry} Uhr</p>
          </div>

          <div style="background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>⏰ Wichtig:</strong> Diese Reservierung ist 3 Stunden kostenlos für Sie reserviert. Bitte schließen Sie Ihre Buchung innerhalb dieser Zeit ab.</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${bookingLink}"
               style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Buchung jetzt abschließen
            </a>
          </div>

          <p style="color: #666; font-size: 14px;">Bei Fragen können Sie uns jederzeit kontaktieren.</p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Diese Email wurde automatisch generiert. Bitte antworten Sie nicht auf diese Email.
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Reservation email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending reservation email:', error);
    return false;
  }
}

/**
 * Sendet Bestätigungs-Email nach Zahlung
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Buchungsdaten
 * @returns {Promise<boolean>} Success status
 */
export async function sendConfirmationEmail(email, data) {
  try {
    const { bookingId, eventDate, productTitle, orderId } = data;

    const formattedDate = format(parseISO(eventDate), 'dd. MMMM yyyy', {
      locale: de,
    });

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Buchung bestätigt - ${productTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28a745;">Ihre Buchung ist bestätigt! ✅</h2>

          <p>Vielen Dank für Ihre Buchung! Ihre Zahlung wurde erfolgreich verarbeitet.</p>

          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Buchungs-Details:</h3>
            <p><strong>Produkt:</strong> ${productTitle}</p>
            <p><strong>Event-Datum:</strong> ${formattedDate}</p>
            <p><strong>Buchungs-ID:</strong> ${bookingId}</p>
            <p><strong>Bestellnummer:</strong> ${orderId}</p>
          </div>

          <div style="background-color: #d4edda; border: 1px solid #28a745; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #155724;">Nächste Schritte:</h4>
            <ul style="margin: 10px 0;">
              <li>Ihre Fotobox wird 2 Tage vor Ihrem Event versendet</li>
              <li>Sie erhalten eine separate Email mit Tracking-Informationen</li>
              <li>Bitte senden Sie die Box 2 Tage nach Ihrem Event zurück</li>
            </ul>
          </div>

          <p style="color: #666;">Wir wünschen Ihnen ein tolles Event! 🎉</p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Diese Email wurde automatisch generiert. Bitte antworten Sie nicht auf diese Email.
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Confirmation email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    return false;
  }
}

/**
 * Sendet Stornierungsbestätigung
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Stornierungsdaten
 * @returns {Promise<boolean>} Success status
 */
export async function sendCancellationEmail(email, data) {
  try {
    const { bookingId, eventDate, productTitle } = data;

    const formattedDate = format(parseISO(eventDate), 'dd. MMMM yyyy', {
      locale: de,
    });

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Buchung storniert - ${productTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc3545;">Ihre Buchung wurde storniert</h2>

          <p>Ihre Buchung wurde erfolgreich storniert.</p>

          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Stornierte Buchung:</h3>
            <p><strong>Produkt:</strong> ${productTitle}</p>
            <p><strong>Event-Datum:</strong> ${formattedDate}</p>
            <p><strong>Buchungs-ID:</strong> ${bookingId}</p>
          </div>

          <p style="color: #666;">Die Rückerstattung wird innerhalb der nächsten Tage bearbeitet.</p>

          <p style="color: #666;">Bei Fragen können Sie uns jederzeit kontaktieren.</p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Diese Email wurde automatisch generiert. Bitte antworten Sie nicht auf diese Email.
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Cancellation email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending cancellation email:', error);
    return false;
  }
}

/**
 * Sendet Photo Strip Editor Email
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Photo Strip Daten
 * @returns {Promise<boolean>} Success status
 */
export async function sendPhotoStripEditorEmail(email, data) {
  try {
    const { bookingId, stripId, accessToken, eventDate, productTitle } = data;

    const formattedDate = format(parseISO(eventDate), 'dd. MMMM yyyy', {
      locale: de,
    });

    const frontendUrl = process.env.FRONTEND_URL || process.env.SHOP_URL || 'https://your-store.myshopify.com';
    const editorLink = `${frontendUrl}/pages/photo-strip-editor?strip=${stripId}&token=${accessToken}`;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Gestalte deinen Fotostreifen - ${productTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #007bff;">Gestalte deinen persönlichen Fotostreifen! 🎨</h2>

          <p>Vielen Dank für deine Buchung! Du kannst jetzt deinen individuellen Fotostreifen gestalten.</p>

          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Buchungs-Details:</h3>
            <p><strong>Produkt:</strong> ${productTitle}</p>
            <p><strong>Event-Datum:</strong> ${formattedDate}</p>
            <p><strong>Buchungs-ID:</strong> ${bookingId}</p>
          </div>

          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #007bff;">Was du tun kannst:</h3>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li style="margin-bottom: 10px;">🖼️ <strong>Dein Logo oder Bilder hochladen</strong> - Füge dein Firmenlogo oder persönliche Bilder hinzu</li>
              <li style="margin-bottom: 10px;">✏️ <strong>Texte hinzufügen</strong> - Schreibe Event-Name, Datum, Hashtags mit verschiedenen Schriftarten</li>
              <li style="margin-bottom: 10px;">🎨 <strong>Hintergrund anpassen</strong> - Wähle Farben, Muster oder Vorlagen</li>
              <li style="margin-bottom: 10px;">📐 <strong>Alles anpassen</strong> - Größe, Position und Rotation nach deinen Wünschen</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${editorLink}"
               style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">
              Jetzt Editor öffnen
            </a>
          </div>

          <div style="background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>⏰ Wichtig:</strong> Bitte gestalte deinen Fotostreifen vor dem <strong>${formattedDate}</strong> (Event-Datum). Dein Design wird dann auf den Fotostreifen gedruckt.</p>
          </div>

          <p style="color: #666; font-size: 14px;">
            💡 <strong>Tipp:</strong> Du kannst jederzeit zu deinem Design zurückkehren und Änderungen vornehmen, bis du es finalisierst.
          </p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Dieser Link ist nur für dich und funktioniert bis 7 Tage nach deinem Event-Datum.<br>
            Diese Email wurde automatisch generiert. Bitte antworten Sie nicht auf diese Email.
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Photo Strip Editor Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Photo strip editor email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending photo strip editor email:', error);
    return false;
  }
}

/**
 * Sendet Bestätigungs-Email nach Zahlung
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Order data
 * @returns {Promise<boolean>} Success status
 */
export async function sendOrderConfirmationEmail(email, data) {
  try {
    const {
      bookingId,
      customerName,
      productTitle,
      startDate,
      endDate,
      orderName,
      setupInstructionsUrl
    } = data;

    const formattedStartDate = format(parseISO(startDate), 'dd. MMMM yyyy', { locale: de });
    const formattedEndDate = endDate && endDate !== startDate
      ? format(parseISO(endDate), 'dd. MMMM yyyy', { locale: de })
      : null;

    const dateRange = formattedEndDate
      ? `${formattedStartDate} - ${formattedEndDate}`
      : formattedStartDate;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Deine Fotobox-Buchung wurde bestätigt! 🎉`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Deine Fotobox-Buchung wurde bestätigt! 🎉</h2>

          <p>Hallo ${customerName || 'there'},</p>

          <p>vielen Dank für deine Bestellung bei YouMe Photo!</p>

          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">📦 Bestelldetails:</h3>
            <p><strong>Bestellung:</strong> ${productTitle}</p>
            <p><strong>📅 Event-Datum:</strong> ${dateRange}</p>
            <p><strong>🆔 Buchungs-ID:</strong> ${bookingId}</p>
            <p><strong>💰 Bestellnummer:</strong> ${orderName}</p>
          </div>

          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
            <h3 style="margin-top: 0; color: #007bff;">Was passiert jetzt?</h3>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Wir bereiten deine Fotobox vor</li>
              <li>Ca. 2-3 Tage vor deinem Event versenden wir die Box</li>
              <li>Du erhältst eine separate Email mit der Sendungsverfolgung</li>
            </ol>
          </div>

          <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>📸 Hinweis:</strong> Du erhältst separat eine Email mit dem Link zum Photo Strip Editor, um dein individuelles Fotostreifen-Design zu gestalten!</p>
          </div>

          ${setupInstructionsUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${setupInstructionsUrl}"
                 style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                📖 Aufbauanleitung ansehen
              </a>
            </div>
          ` : ''}

          <p style="color: #666; font-size: 14px;">Fragen? Einfach auf diese Email antworten!</p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Viele Grüße<br>
            Dein YouMe Photo Team
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Order Confirmation Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Order confirmation email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    return false;
  }
}

/**
 * Sendet Versandbestätigung mit Tracking-Info
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Shipping data
 * @returns {Promise<boolean>} Success status
 */
export async function sendShippingConfirmationEmail(email, data) {
  try {
    const {
      bookingId,
      customerName,
      productTitle,
      trackingNumber,
      startDate,
      setupInstructionsUrl
    } = data;

    const formattedStartDate = format(parseISO(startDate), 'dd. MMMM yyyy', { locale: de });
    const trackingUrl = `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${trackingNumber}`;

    // Estimate delivery (2 days before event)
    const eventDateObj = parseISO(startDate);
    const { subDays } = await import('date-fns');
    const estimatedDelivery = format(subDays(eventDateObj, 2), 'dd. MMMM yyyy', { locale: de });

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Deine Fotobox ist unterwegs! 📦`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Deine Fotobox ist unterwegs! 📦</h2>

          <p>Hallo ${customerName || 'there'},</p>

          <p>deine Fotobox wurde heute versendet!</p>

          <div style="background-color: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
            <h3 style="margin-top: 0;">📦 Versandinformationen:</h3>
            <p><strong>Sendungsnummer:</strong> <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${trackingNumber}</code></p>
            <p><strong>📅 Voraussichtliche Zustellung:</strong> ${estimatedDelivery}</p>
            <p><strong>Event-Datum:</strong> ${formattedStartDate}</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${trackingUrl}"
               style="background-color: #ffcc00; color: #000; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              🔗 Sendung verfolgen
            </a>
          </div>

          ${setupInstructionsUrl ? `
            <div style="text-align: center; margin: 20px 0;">
              <a href="${setupInstructionsUrl}"
                 style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                📖 Aufbauanleitung ansehen
              </a>
            </div>
          ` : ''}

          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">⚠️ Wichtig:</h3>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Bitte prüfe den Inhalt bei Erhalt</li>
              <li>Bei Fragen oder Problemen: Sofort melden!</li>
              <li>Rücksendung nach dem Event mit dem beiliegenden Label</li>
            </ul>
          </div>

          <p style="color: #666; font-size: 14px;">Viel Erfolg bei deinem Event! 🎉</p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Viele Grüße<br>
            Dein YouMe Photo Team
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Shipping Confirmation Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Shipping confirmation email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending shipping confirmation email:', error);
    return false;
  }
}

/**
 * Sendet Rückgabe-Erinnerung
 *
 * @param {string} email - Empfänger-Email
 * @param {object} data - Booking data
 * @returns {Promise<boolean>} Success status
 */
export async function sendReturnReminderEmail(email, data) {
  try {
    const { bookingId, customerName, productTitle, endDate } = data;

    const formattedEndDate = format(parseISO(endDate), 'dd. MMMM yyyy', { locale: de });

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: `Erinnerung: Rücksendung deiner Fotobox`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Erinnerung: Rücksendung deiner Fotobox</h2>

          <p>Hallo ${customerName || 'there'},</p>

          <p>dein Event ist vorbei - wir hoffen, es war ein Erfolg! 🎉</p>

          <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h3 style="margin-top: 0;">📦 Rücksendung:</h3>
            <p><strong>Produkt:</strong> ${productTitle}</p>
            <p><strong>Event-Datum:</strong> ${formattedEndDate}</p>
            <p><strong>Buchungs-ID:</strong> ${bookingId}</p>
          </div>

          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Bitte sende die Fotobox zeitnah zurück:</h3>
            <ol style="margin: 10px 0; padding-left: 20px;">
              <li>Nutze das beiliegende Rücksendelabel</li>
              <li>Verpacke alles sorgfältig in der Original-Box</li>
              <li>Gib das Paket bei der nächsten DHL-Filiale ab</li>
            </ol>
          </div>

          <div style="background-color: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>ℹ️ Hinweis:</strong> Falls bereits zurückgeschickt: Bitte ignoriere diese Email.</p>
          </div>

          <p style="color: #666; font-size: 14px;">Bei Fragen: Melde dich!</p>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <p style="color: #999; font-size: 12px;">
            Viele Grüße<br>
            Dein YouMe Photo Team
          </p>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Return Reminder Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Return reminder email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending return reminder email:', error);
    return false;
  }
}

/**
 * Sendet Konflikt-Alert an Admin wenn ein Buchungskonflikt erkannt wird
 * (z.B. wenn Soft Lock abgelaufen ist und der Slot bereits gebucht wurde)
 *
 * @param {object} data - Konfliktdaten
 * @returns {Promise<boolean>} Success status
 */
export async function sendConflictAlertEmail(data) {
  try {
    const {
      bookingId,
      orderId,
      orderName,
      customerEmail,
      customerName,
      eventDate,
      productTitle,
      variantTitle
    } = data;

    const formattedDate = format(parseISO(eventDate), 'dd. MMMM yyyy', { locale: de });

    // Admin Email aus ENV oder Fallback
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: adminEmail,
      subject: `⚠️ BUCHUNGSKONFLIKT: ${orderName} - Manuelle Intervention erforderlich`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #dc3545; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">⚠️ BUCHUNGSKONFLIKT ERKANNT</h2>
          </div>

          <div style="border: 2px solid #dc3545; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            <p><strong>Ein Kunde hat eine Bestellung abgeschlossen, aber der gewünschte Termin ist nicht mehr verfügbar!</strong></p>

            <div style="background-color: #f8d7da; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #721c24;">Konflikt-Details:</h3>
              <p><strong>Bestellung:</strong> ${orderName}</p>
              <p><strong>Shopify Order ID:</strong> ${orderId}</p>
              <p><strong>Booking ID:</strong> ${bookingId}</p>
              <p><strong>Produkt:</strong> ${productTitle}${variantTitle ? ` - ${variantTitle}` : ''}</p>
              <p><strong>Gewünschtes Datum:</strong> ${formattedDate}</p>
            </div>

            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Kundendaten:</h3>
              <p><strong>Name:</strong> ${customerName || 'Nicht angegeben'}</p>
              <p><strong>Email:</strong> ${customerEmail}</p>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #856404;">📋 Erforderliche Maßnahmen:</h3>
              <ol style="margin: 10px 0; padding-left: 20px;">
                <li>Kontaktiere den Kunden umgehend</li>
                <li>Biete alternative Termine an</li>
                <li>Falls kein Alternativtermin möglich: Erstattung via Shopify Admin</li>
                <li>Aktualisiere den Buchungsstatus im Admin Panel</li>
              </ol>
            </div>

            <p style="color: #666; font-size: 14px;">
              <strong>Warum passiert das?</strong><br>
              Der Kunde hat während des Checkouts zu lange gebraucht und der Soft Lock (Reservierungs-Timer) ist abgelaufen.
              In der Zwischenzeit hat ein anderer Kunde denselben Termin erfolgreich gebucht.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.ADMIN_URL || process.env.BACKEND_URL}/admin"
                 style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Zum Admin Panel
              </a>
            </div>
          </div>
        </div>
      `,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV] Conflict Alert Email would be sent:', mailOptions);
      return true;
    }

    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📧 Conflict alert email sent to admin (${adminEmail})`);
    return true;
  } catch (error) {
    console.error('Error sending conflict alert email:', error);
    return false;
  }
}
