import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DHL Business Customer Shipping API Integration
 * Handles label generation, tracking, and shipment management
 *
 * API Documentation: https://entwickler.dhl.de/group/ep/apis/post/parcel/de/shipping/v2/orders
 *
 * IMPORTANT: Add these environment variables to .env:
 * - DHL_API_KEY=your_api_key (from DHL Developer Portal)
 * - DHL_API_SECRET=your_api_secret (from DHL Developer Portal)
 * - DHL_USERNAME=user-valid (sandbox: user-valid)
 * - DHL_PASSWORD=SandboxPasswort2023! (sandbox password)
 * - DHL_API_ENDPOINT=https://api-sandbox.dhl.com/parcel/de/shipping/v2
 * - DHL_TOKEN_ENDPOINT=https://api-sandbox.dhl.com/parcel/de/account/auth/ropc/v1/token
 * - DHL_ACCOUNT_NUMBER=your_account_number
 * - DHL_RETURN_ACCOUNT_NUMBER=your_return_account_number
 */
class DHLService {
  constructor() {
    // OAuth 2.0 Credentials
    this.apiKey = process.env.DHL_API_KEY;
    this.apiSecret = process.env.DHL_API_SECRET;

    // OAuth Username/Password for token
    this.username = process.env.DHL_USERNAME || "user-valid";
    this.password = process.env.DHL_PASSWORD || "SandboxPasswort2023!";

    // API Endpoints
    this.apiEndpoint =
      process.env.DHL_API_ENDPOINT ||
      "https://api-sandbox.dhl.com/parcel/de/shipping/v2";
    this.tokenEndpoint =
      process.env.DHL_TOKEN_ENDPOINT ||
      "https://api-sandbox.dhl.com/parcel/de/account/auth/ropc/v1/token";

    this.accountNumber = process.env.DHL_ACCOUNT_NUMBER;
    this.returnAccountNumber = process.env.DHL_RETURN_ACCOUNT_NUMBER;

    // Token cache
    this.accessToken = null;
    this.tokenExpiry = null;

    // Shipper (your company) address
    this.shipperAddress = {
      name: process.env.SHIPPER_NAME || "YouMe Photo",
      street: process.env.SHIPPER_STREET || "Musterstraße",
      streetNumber: process.env.SHIPPER_STREET_NUMBER || "123",
      zip: process.env.SHIPPER_ZIP || "12345",
      city: process.env.SHIPPER_CITY || "Berlin",
      country: "Germany",
      countryCode: "DEU", // ISO 3166-1 alpha-3 (3-letter code)
      email: process.env.SMTP_USER || "info@youmephoto.com",
      phone: process.env.SHIPPER_PHONE || "+49 30 12345678",
    };
  }

  /**
   * Check if DHL credentials are configured
   * @returns {boolean}
   */
  isConfigured() {
    // Check for OAuth credentials
    // Note: For Sandbox, billingNumber can be test value
    const hasOAuthCreds = !!(
      this.apiKey &&
      this.apiSecret &&
      this.username &&
      this.password
    );
    return hasOAuthCreds;
  }

  /**
   * Get OAuth 2.0 access token
   * Uses ROPC (Resource Owner Password Credentials) flow
   * @private
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    try {
      console.log("🔑 Fetching DHL OAuth token...");

      // Build form data for token request
      const params = new URLSearchParams({
        grant_type: "password",
        username: this.username,
        password: this.password,
        client_id: this.apiKey,
        client_secret: this.apiSecret,
      });

      const response = await axios.post(this.tokenEndpoint, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      this.accessToken = response.data.access_token;
      // Set expiry with 60 second buffer
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;

      console.log(`✓ DHL OAuth token acquired (expires in ${expiresIn}s)`);

      return this.accessToken;
    } catch (error) {
      console.error("❌ Failed to get DHL OAuth token:", error.message);
      if (error.response) {
        console.error("Response:", error.response.data);
      }
      throw new Error(`DHL OAuth authentication failed: ${error.message}`);
    }
  }

  /**
   * Create shipping label via DHL Business Customer Shipping API
   * @param {object} params - Shipping parameters
   * @param {object} params.booking - Booking data
   * @param {object} params.shippingAddress - Shipping address data
   * @returns {Promise<{success: boolean, labelUrl?: string, trackingNumber?: string, error?: string}>}
   */
  async createShippingLabel({ booking, shippingAddress }) {
    try {
      if (!this.isConfigured()) {
        console.warn(
          "⚠️ DHL API not configured. Set DHL_API_KEY, DHL_API_SECRET, DHL_USERNAME, DHL_PASSWORD, DHL_ACCOUNT_NUMBER in .env"
        );

        // For development: Return mock data
        if (process.env.NODE_ENV === "development") {
          return this._createMockLabel(booking);
        }

        return {
          success: false,
          error: "DHL API credentials not configured",
        };
      }

      // Build DHL API request
      const dhlRequest = this._buildShippingRequest(booking, shippingAddress);

      console.log(`📦 Creating DHL label for booking ${booking.booking_id}...`);
      console.log("📦 DHL Request:", JSON.stringify(dhlRequest, null, 2));

      // Get OAuth access token
      const token = await this.getAccessToken();

      // Build request config with Bearer token
      const requestConfig = {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      };

      // Call DHL API
      const response = await axios.post(
        `${this.apiEndpoint}/orders`,
        dhlRequest,
        requestConfig
      );

      console.log("📦 DHL API Response:", JSON.stringify(response.data, null, 2));

      // V2 API returns array of items with status
      if (!response.data.items || response.data.items.length === 0) {
        throw new Error("DHL API returned no shipment data");
      }

      const shipment = response.data.items[0];

      // Check for errors
      // DHL V2 API uses HTTP status codes: 200 = success, 4xx/5xx = error
      if (shipment.sstatus && shipment.sstatus.statusCode >= 400) {
        const errorMsg = shipment.sstatus.statusMessage || shipment.sstatus.title || "Unknown DHL error";
        throw new Error(`DHL API Error: ${errorMsg}`);
      }

      // Extract shipment number and label
      const shipmentNumber = shipment.shipmentNo || shipment.trackingNumber;
      const labelData = shipment.label?.b64 || shipment.label;

      if (!labelData) {
        throw new Error("No label data returned from DHL API");
      }

      // Save label PDF
      const labelUrl = await this._saveLabelPDF(booking.booking_id, labelData);

      console.log(`✓ DHL label created: ${shipmentNumber}`);

      return {
        success: true,
        trackingNumber: shipmentNumber,
        labelUrl,
        shipmentNumber,
      };
    } catch (error) {
      console.error("❌ DHL API Error:", error.message);

      // Log detailed error response from DHL
      if (error.response) {
        console.error("DHL API Status:", error.response.status);
        console.error("DHL API Response:", JSON.stringify(error.response.data, null, 2));
      }

      // Return mock data in development
      if (process.env.NODE_ENV === "development") {
        console.log("📦 Using mock label for development");
        return this._createMockLabel(booking);
      }

      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  /**
   * Build DHL Shipping Request (V2 API format)
   * @private
   */
  _buildShippingRequest(booking, shippingAddress) {
    const shipmentDate = this._formatDate(new Date());

    // Use billing number (for sandbox: test values like "33333333330101")
    const billingNumber = this.accountNumber || "33333333330101";

    // Use separate street and street_number if available
    const shipperStreet = this.shipperAddress.street;
    const shipperHouse = this.shipperAddress.streetNumber;

    // Parse consignee address: if street_number is empty, try to extract from street
    let consigneeStreet = shippingAddress.street || "";
    let consigneeHouse = shippingAddress.street_number || "";

    // If house number is empty but street contains a number, parse it
    if (!consigneeHouse && consigneeStreet) {
      const parsed = this._parseAddress(consigneeStreet);
      consigneeStreet = parsed.street;
      consigneeHouse = parsed.number;
    }

    // DHL requires addressHouse to be 1-10 characters, use "1" as fallback
    if (!consigneeHouse) {
      consigneeHouse = "1";
    }

    // Shorten refNo to max 35 chars (DHL requirement: 8-35)
    const refNo = booking.booking_id ? booking.booking_id.substring(0, 35) : "BOOKING";

    // Ensure phone is not empty (DHL requirement: 1-20 chars)
    const consigneePhone = (shippingAddress.phone || "+49000000000").substring(0, 20);

    return {
      profile: "STANDARD_GRUPPENPROFIL",
      shipments: [
        {
          product: "V01PAK", // DHL Paket
          billingNumber: billingNumber,
          refNo: refNo,
          shipDate: shipmentDate,
          shipper: {
            name1: this.shipperAddress.name,
            addressStreet: shipperStreet,
            addressHouse: shipperHouse,
            postalCode: this.shipperAddress.zip,
            city: this.shipperAddress.city,
            country: "DEU", // ISO 3166-1 alpha-3 (3-letter code)
            email: this.shipperAddress.email,
            phone: this.shipperAddress.phone,
          },
          consignee: {
            name1: shippingAddress.name || booking.customer_name || booking.customer_email,
            addressStreet: consigneeStreet,
            addressHouse: consigneeHouse,
            postalCode: shippingAddress.postal_code || "",
            city: shippingAddress.city || "",
            country: "DEU", // ISO 3166-1 alpha-3 (3-letter code)
            email: booking.customer_email,
            phone: consigneePhone,
          },
          details: {
            weight: {
              uom: "kg",
              value: 5,
            },
          },
          services: {
            // Return label disabled for sandbox
            // Sandbox test billing numbers don't support return labels
          },
        },
      ],
    };
  }

  /**
   * Parse address into street name and number
   * @private
   */
  _parseAddress(address) {
    const match = address.match(/^(.+?)\s+(\d+.*)$/);
    if (match) {
      return {
        street: match[1].trim(),
        number: match[2].trim(),
      };
    }
    return {
      street: address,
      number: "",
    };
  }

  /**
   * Save label PDF to disk
   * @private
   */
  async _saveLabelPDF(bookingId, labelDataBase64) {
    try {
      // Determine upload path
      const baseUploadPath =
        process.env.NODE_ENV === "production"
          ? "/app/data/uploads"
          : path.join(__dirname, "../uploads");

      const labelsDir = path.join(baseUploadPath, "shipping-labels");
      await fs.mkdir(labelsDir, { recursive: true });

      const filename = `${bookingId}_${Date.now()}.pdf`;
      const filepath = path.join(labelsDir, filename);

      // Decode base64 and save
      const buffer = Buffer.from(labelDataBase64, "base64");
      await fs.writeFile(filepath, buffer);

      // Return relative URL path
      const relativePath = `shipping-labels/${filename}`;

      console.log(`✓ Label PDF saved: ${relativePath}`);

      return relativePath;
    } catch (error) {
      console.error("Error saving label PDF:", error);
      throw error;
    }
  }

  /**
   * Get tracking information from DHL
   * @param {string} trackingNumber - DHL tracking number
   * @returns {Promise<{status: string, description: string, location: string, timestamp: string, events: Array}>}
   */
  async getTrackingInfo(trackingNumber) {
    try {
      if (!this.isConfigured()) {
        return this._getMockTracking(trackingNumber);
      }

      // Get OAuth access token
      const token = await this.getAccessToken();

      // Build request config with Bearer token
      const requestConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      const response = await axios.get(
        `${this.apiEndpoint}/tracking/${trackingNumber}`,
        requestConfig
      );

      const tracking = response.data.shipments[0];
      const latestEvent = tracking.events[0];

      return {
        trackingNumber,
        status: this._mapDHLStatus(latestEvent.statusCode),
        description: latestEvent.statusText,
        location: latestEvent.location?.address?.addressLocality || "",
        timestamp: latestEvent.timestamp,
        events: tracking.events.map((event) => ({
          status: this._mapDHLStatus(event.statusCode),
          description: event.statusText,
          location: event.location?.address?.addressLocality || "",
          timestamp: event.timestamp,
        })),
      };
    } catch (error) {
      console.error("Error getting tracking info:", error.message);

      if (process.env.NODE_ENV === "development") {
        return this._getMockTracking(trackingNumber);
      }

      throw error;
    }
  }

  /**
   * Map DHL status codes to our internal status
   * @private
   */
  _mapDHLStatus(dhlStatusCode) {
    const statusMap = {
      "01": "in_transit", // Die Sendung wurde abgeholt
      "02": "in_transit", // Die Sendung befindet sich im Verteilzentrum
      "03": "out_for_delivery", // Die Sendung befindet sich in der Zustellung
      "04": "delivered", // Die Sendung wurde zugestellt
      "05": "exception", // Zustellung fehlgeschlagen
      "06": "returned", // Sendung wird zurückgesendet
      "07": "in_transit", // Die Sendung ist unterwegs
      "08": "exception", // Zollanmeldung erforderlich
      "09": "delivered", // Abholung erfolgt
    };

    return statusMap[dhlStatusCode] || "in_transit";
  }

  /**
   * Cancel shipment (only if not yet picked up)
   * @param {string} shipmentNumber - DHL shipment number
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async cancelShipment(shipmentNumber) {
    try {
      if (!this.isConfigured()) {
        return { success: true }; // Mock success in dev
      }

      // Get OAuth access token
      const token = await this.getAccessToken();

      // Build request config with Bearer token
      const requestConfig = {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };

      await axios.delete(
        `${this.apiEndpoint}/orders/${shipmentNumber}`,
        requestConfig
      );

      console.log(`✓ Shipment ${shipmentNumber} cancelled`);

      return { success: true };
    } catch (error) {
      console.error("Error cancelling shipment:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Format date for DHL API (YYYY-MM-DD)
   * @private
   */
  _formatDate(date) {
    return date.toISOString().split("T")[0];
  }

  /**
   * Create mock label for development
   * @private
   */
  _createMockLabel(booking) {
    const mockTrackingNumber = `TEST${Date.now().toString().slice(-10)}`;

    console.log(
      `📦 [DEV] Mock label created for booking ${booking.booking_id}`
    );
    console.log(`   Tracking: ${mockTrackingNumber}`);

    return {
      success: true,
      trackingNumber: mockTrackingNumber,
      labelUrl: `shipping-labels/mock_${booking.booking_id}.pdf`,
      shipmentNumber: mockTrackingNumber,
      _isMock: true,
    };
  }

  /**
   * Get mock tracking for development
   * @private
   */
  _getMockTracking(trackingNumber) {
    return {
      trackingNumber,
      status: "in_transit",
      description: "Die Sendung befindet sich in der Zustellung",
      location: "Berlin",
      timestamp: new Date().toISOString(),
      events: [
        {
          status: "in_transit",
          description: "Die Sendung wurde abgeholt",
          location: "Berlin",
          timestamp: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      _isMock: true,
    };
  }
}

export default new DHLService();
