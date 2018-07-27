# -*- coding: utf-8 -*-
from odoo import api, fields, models

class pos_discount(models.Model):

    _name = "pos.global.discount"

    name = fields.Char('Name', required=1)
    amount = fields.Float('Amount', required=1)
    product_id = fields.Many2one('product.product', 'Global Discount', domain=[('sale_ok', '=', True), ('available_in_pos', '=', True)], required=1)

    @api.model
    def default_get(self, default_fields):
        res = super(pos_discount, self).default_get(default_fields)
        products = self.env['product.product'].search([('name', '=', 'Discount')])
        if products:
            res.update({'product_id': products[0].id})
        return res
