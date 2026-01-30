import path from 'path';
import { fileURLToPath } from 'url';
import { prepare } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/**
 * TemplateService
 * Manages design templates for photo strips
 */
class TemplateService {
  /**
   * Get all active templates
   * @returns {Array<object>} List of active templates
   */
  async getAllActiveTemplates() {
    try {
      const query = await prepare(`
        SELECT * FROM design_templates
        WHERE is_active = 1
        ORDER BY display_order ASC, created_at ASC
      `);
      const templates = await query.all();

      return templates.map(template => ({
        ...template,
        template_data: JSON.parse(template.template_data)
      }));
    } catch (error) {
      console.error('Error getting active templates:', error);
      return [];
    }
  }

  /**
   * Get all templates (including inactive) - admin only
   * @returns {Array<object>} List of all templates
   */
  async getAllTemplates() {
    try {
      const query = await prepare(`
        SELECT * FROM design_templates
        ORDER BY display_order ASC, created_at ASC
      `);
      const templates = await query.all();

      return templates.map(template => ({
        ...template,
        template_data: JSON.parse(template.template_data)
      }));
    } catch (error) {
      console.error('Error getting all templates:', error);
      return [];
    }
  }

  /**
   * Get template by ID
   * @param {number} templateId - Template ID
   * @returns {object|null} Template object or null
   */
  async getTemplateById(templateId) {
    try {
      const query = await prepare(`
        SELECT * FROM design_templates WHERE id = $1
      `);
      const template = await query.get(templateId);

      if (!template) {
        return null;
      }

      return {
        ...template,
        template_data: JSON.parse(template.template_data)
      };
    } catch (error) {
      console.error('Error getting template by ID:', error);
      return null;
    }
  }

  /**
   * Get templates by category
   * @param {string} category - Category name (wedding, birthday, corporate, custom)
   * @returns {Array<object>} List of templates in category
   */
  async getTemplatesByCategory(category) {
    try {
      const query = await prepare(`
        SELECT * FROM design_templates
        WHERE category = $1 AND is_active = 1
        ORDER BY display_order ASC
      `);
      const templates = await query.all(category);

      return templates.map(template => ({
        ...template,
        template_data: JSON.parse(template.template_data)
      }));
    } catch (error) {
      console.error('Error getting templates by category:', error);
      return [];
    }
  }

  /**
   * Create new template (admin only)
   * @param {string} name - Template name
   * @param {string} category - Category
   * @param {object} templateData - Fabric.js canvas data
   * @param {string} description - Description
   * @param {string} thumbnailPath - Path to thumbnail image
   * @param {number} displayOrder - Display order
   * @returns {{success: boolean, templateId?: number, error?: string}}
   */
  async createTemplate(name, category, templateData, description = '', thumbnailPath = null, displayOrder = 0) {
    try {
      const stmt = await prepare(`
        INSERT INTO design_templates (
          name, category, template_data, description,
          thumbnail_path, display_order, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, 1)
      `);

      const result = await stmt.run(
        name,
        category,
        JSON.stringify(templateData),
        description,
        thumbnailPath,
        displayOrder
      );

      const templateId = result?.id;
      console.log(`✓ Template created: ${name} (ID: ${templateId})`);

      return { success: true, templateId };
    } catch (error) {
      console.error('Error creating template:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update template (admin only)
   * @param {number} templateId - Template ID
   * @param {object} updates - Fields to update
   * @returns {{success: boolean, error?: string}}
   */
  async updateTemplate(templateId, updates) {
    try {
      const allowedFields = ['name', 'category', 'template_data', 'description', 'thumbnail_path', 'display_order', 'is_active'];
      const fields = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          const placeholder = `$${values.length + 1}`;
          fields.push(`${key} = ${placeholder}`);
          // Stringify template_data if it's an object
          if (key === 'template_data' && typeof value === 'object') {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }
      }

      if (fields.length === 0) {
        return { success: false, error: 'No valid fields to update' };
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(templateId);

      const placeholder = `$${values.length}`;
      const stmt = await prepare(`
        UPDATE design_templates
        SET ${fields.join(', ')}
        WHERE id = ${placeholder}
      `);

      await stmt.run(...values);

      console.log(`✓ Template ${templateId} updated`);

      return { success: true };
    } catch (error) {
      console.error('Error updating template:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete template (admin only) - soft delete by setting is_active = 0
   * @param {number} templateId - Template ID
   * @returns {{success: boolean, error?: string}}
   */
  async deleteTemplate(templateId) {
    try {
      const stmt = await prepare(`
        UPDATE design_templates
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `);

      await stmt.run(templateId);

      console.log(`✓ Template ${templateId} deactivated`);

      return { success: true };
    } catch (error) {
      console.error('Error deleting template:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Permanently delete template (admin only)
   * @param {number} templateId - Template ID
   * @returns {{success: boolean, error?: string}}
   */
  async permanentlyDeleteTemplate(templateId) {
    try {
      const stmt = await prepare(`DELETE FROM design_templates WHERE id = $1`);
      await stmt.run(templateId);

      console.log(`✓ Template ${templateId} permanently deleted`);

      return { success: true };
    } catch (error) {
      console.error('Error permanently deleting template:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Initialize default templates
   * Creates 3 default templates if none exist
   * @returns {{success: boolean, created: number}}
   */
  async initializeDefaultTemplates() {
    try {
      // Check if templates already exist
      const query = await prepare('SELECT COUNT(*) as count FROM design_templates');
      const count = await query.get();

      if (count.count > 0) {
        console.log('Templates already exist, skipping initialization');
        return { success: true, created: 0 };
      }

      // Template 1: Hochzeit Elegant
      const weddingTemplate = {
        version: '6.0.2',
        objects: [
          {
            type: 'text',
            text: 'Unsere Hochzeit',
            fontFamily: 'Outfit',
            fontSize: 60,
            fill: '#d4af37',
            left: 400,
            top: 200,
            originX: 'center',
            originY: 'center',
            fontWeight: 'bold'
          },
          {
            type: 'text',
            text: 'Sarah & Michael',
            fontFamily: 'Dancing Script',
            fontSize: 48,
            fill: '#333333',
            left: 400,
            top: 300,
            originX: 'center',
            originY: 'center'
          },
          {
            type: 'rect',
            width: 600,
            height: 3,
            fill: '#d4af37',
            left: 100,
            top: 350,
            rx: 1,
            ry: 1
          }
        ],
        background: '#f5e6d3'
      };

      await this.createTemplate(
        'Hochzeit Elegant',
        'wedding',
        weddingTemplate,
        'Elegantes Design für Hochzeiten mit goldenen Akzenten',
        null,
        1
      );

      // Template 2: Geburtstag Bunt
      const birthdayTemplate = {
        version: '6.0.2',
        objects: [
          {
            type: 'text',
            text: 'Happy Birthday!',
            fontFamily: 'Fredoka One',
            fontSize: 64,
            fill: '#ff6b6b',
            left: 400,
            top: 250,
            originX: 'center',
            originY: 'center',
            fontWeight: 'bold'
          },
          {
            type: 'circle',
            radius: 40,
            fill: '#feca57',
            left: 150,
            top: 150
          },
          {
            type: 'circle',
            radius: 40,
            fill: '#48dbfb',
            left: 650,
            top: 150
          },
          {
            type: 'circle',
            radius: 40,
            fill: '#ff9ff3',
            left: 150,
            top: 350
          },
          {
            type: 'circle',
            radius: 40,
            fill: '#54a0ff',
            left: 650,
            top: 350
          }
        ],
        background: '#ffffff'
      };

      await this.createTemplate(
        'Geburtstag Bunt',
        'birthday',
        birthdayTemplate,
        'Farbenfrohe Vorlage für Geburtstagsfeiern',
        null,
        2
      );

      // Template 3: Corporate Professional
      const corporateTemplate = {
        version: '6.0.2',
        objects: [
          {
            type: 'rect',
            width: 800,
            height: 200,
            fill: '#2c3e50',
            left: 0,
            top: 0
          },
          {
            type: 'text',
            text: 'Company Event 2026',
            fontFamily: 'Roboto',
            fontSize: 48,
            fill: '#ffffff',
            left: 400,
            top: 100,
            originX: 'center',
            originY: 'center',
            fontWeight: 'bold'
          },
          {
            type: 'text',
            text: 'Ihr Logo hier',
            fontFamily: 'Roboto',
            fontSize: 24,
            fill: '#7f8c8d',
            left: 400,
            top: 300,
            originX: 'center',
            originY: 'center'
          }
        ],
        background: '#ecf0f1'
      };

      await this.createTemplate(
        'Corporate Professional',
        'corporate',
        corporateTemplate,
        'Professionelles Design für Firmenevents',
        null,
        3
      );

      console.log('✓ Default templates initialized');

      return { success: true, created: 3 };
    } catch (error) {
      console.error('Error initializing default templates:', error);
      return { success: false, created: 0 };
    }
  }
}

export default new TemplateService();
