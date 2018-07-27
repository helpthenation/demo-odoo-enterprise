# -*- coding: utf-8 -*-
from odoo import fields, api, models
import logging

_logger = logging.getLogger(__name__)


class stock_move(models.Model):
    _inherit = "stock.move"

    @api.model
    def create(self, vals):
        """
        if move create from pos order line
        and pol have uom ID and pol uom ID difference with current move
        we'll re-update product_uom of move
        FOR linked stock on hand of product
        """
        move = super(stock_move, self).create(vals)
        order_lines = self.env['pos.order.line'].search([
            ('name', '=', move.name),
            ('product_id', '=', move.product_id.id),
            ('qty', '=', move.product_uom_qty)
        ])
        for line in order_lines:
            if line.uom_id and line.uom_id != move.product_uom:
                move.write({
                    'product_uom': line.uom_id.id
                })
        return move

    @api.multi
    def write(self, vals):
        res = super(stock_move, self).write(vals)
        sessions = self.env['pos.session'].sudo().search([
            ('state', '=', 'opened'),
        ])
        cache_model = self.env['pos.cache.database'].sudo()
        if vals.get('state', False) == 'done':
            for move in self:
                if move.product_id:
                    for session in sessions:
                        if session.config_id.stock_location_id:
                            stock_ids = cache_model.get_all_stock_by_stock_id(session.config_id.stock_location_id.id)
                            datas = cache_model.get_product_available_filter_by_stock_location_ids_and_product_id(
                                tuple(stock_ids), move.product_id.id)
                            data = move.product_id.get_data()
                            if datas and datas.get(move.product_id.id, 0):
                                data['qty_available'] = datas[move.product_id.id]
                            else:
                                data['qty_available'] = 0
                            data['model'] = 'product.product'
                            self.env['pos.cache.database'].sync_to_pos(data)

        return res

#v11 only
class stock_move_line(models.Model):

    _inherit = "stock.move.line"

    @api.model
    def create(self, vals):
        """
            * When cashier choice product have tracking is not none
            * And submit to sale order to backend
        """
        if vals.get('move_id', None):
            move = self.env['stock.move'].browse(vals.get('move_id'))
            if move.sale_line_id and move.sale_line_id.lot_id:
                vals.update({'lot_id': move.sale_line_id.lot_id.id})
        return super(stock_move_line, self).create(vals)


