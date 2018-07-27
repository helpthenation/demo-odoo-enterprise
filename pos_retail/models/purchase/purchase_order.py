from odoo import api, models, fields
import odoo

class purchase_order(models.Model):
    _inherit = "purchase.order"

    signature = fields.Binary('Signature', readonly=1)
    journal_id = fields.Many2one('account.journal', 'Vendor bill Journal')

    @api.model
    def create_po(self, vals, purchase_order_state):
        version_info = odoo.release.version_info
        po = self.create(vals)
        for line in po.order_line:
            line.onchange_product_id()
        po.button_confirm()
        if purchase_order_state in ['confirm_picking', 'confirm_invoice']:
            for picking in po.picking_ids:
                if version_info == 11:
                    for move_line in picking.move_line_ids:
                        move_line.write({'qty_done': move_line.product_uom_qty})
                for move_line in picking.move_lines:
                    move_line.write({'quantity_done': move_line.product_uom_qty})
                if version_info == 11:
                    picking.button_validate()
                if version_info == 10:
                    picking.do_new_transfer()
        if purchase_order_state == 'confirm_invoice':
            partner = po.partner_id
            account_id = partner.property_account_payable_id.id
            if version_info == 11:
                invoice = self.env['account.invoice'].create({
                    'type': 'in_invoice',
                    'currency_id': po.currency_id.id,
                    'partner_id': partner.id,
                    'origin': po.name,
                    'account_id': account_id,
                    'purchase_id': po.id,
                    'payment_term_id': partner.property_payment_term_id.id if partner.property_payment_term_id else None,
                })
            if version_info == 11:
                invoice = self.env['account.invoice'].create({
                    'type': 'in_invoice',
                    'currency_id': po.currency_id.id,
                    'partner_id': partner.id,
                    'origin': po.name,
                    'account_id': account_id,
                    'purchase_id': po.id,
                })
            if po.journal_id:
                invoice.write({'journal_id': po.journal_id.id})
            for po_line in po.order_line:
                self.env['account.invoice.line'].create({
                    'payment_term_id': po.payment_term_id.id if po.payment_term_id else None,
                    'purchase_id': po.id,
                    'purchase_line_id': po_line.id,
                    'invoice_line_tax_ids': [[6, False, [tax.id for tax in po_line.taxes_id]]],
                    'product_id': po_line.product_id.id,
                    'name': po_line.name if po_line.name else po.name,
                    'account_id': account_id,
                    'quantity': po_line.product_qty,
                    'uom_id': po_line.product_uom.id if po_line.product_uom else None,
                    'price_unit': po_line.price_unit,
                    'invoice_id': invoice.id
                })
            invoice.action_invoice_open()
        return {
            'name': po.name,
            'id': po.id
        }
