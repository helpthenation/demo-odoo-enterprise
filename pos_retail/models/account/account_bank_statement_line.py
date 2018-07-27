# -*- coding: utf-8 -*-
from odoo import api, fields, models, _

class account_bank_statement_line(models.Model):
    _inherit = "account.bank.statement.line"

    # multi currency
    def fast_counterpart_creation(self):
        from_pos = False
        for st_line in self:
            if st_line.amount_currency != 0 and st_line.pos_statement_id and st_line.pos_statement_id.create_uid and st_line.pos_statement_id.create_uid.company_id and st_line.pos_statement_id.create_uid.company_id.currency_id and st_line.pos_statement_id.create_uid.company_id.currency_id.id != st_line.currency_id.id:
                from_pos= True
        if from_pos == True:
            for st_line in self:
                vals = {}
                if st_line.pos_statement_id and st_line.pos_statement_id.create_uid and st_line.pos_statement_id.create_uid.company_id and st_line.pos_statement_id.create_uid.company_id.currency_id and st_line.pos_statement_id.create_uid.company_id.currency_id.id != st_line.currency_id.id:
                    vals = {
                        'name': st_line.name,
                        'debit': st_line.amount_currency < 0 and -st_line.amount_currency or 0.0,
                        'credit': st_line.amount_currency > 0 and st_line.amount_currency or 0.0,
                        'account_id': st_line.account_id.id,
                        'currency_id': st_line.currency_id.id,
                        'amount_currency': st_line.amount_currency,
                    }
                else:
                    vals = {
                        'name': st_line.name,
                        'debit': st_line.amount < 0 and -st_line.amount or 0.0,
                        'credit': st_line.amount > 0 and st_line.amount or 0.0,
                        'account_id': st_line.account_id.id,
                    }
                st_line.process_reconciliation(new_aml_dicts=[vals])
        else:
            return super(account_bank_statement_line, self).fast_counterpart_creation()


    def create(self, vals):
        statement_line = super(account_bank_statement_line, self).create(vals)
        Credit = self.env['res.partner.credit']
        if vals.get('pos_statement_id', False) \
                and statement_line.journal_id \
                and statement_line.journal_id.pos_method_type == 'credit' \
                and statement_line.pos_statement_id \
                and statement_line.pos_statement_id.partner_id:
            if statement_line.amount > 0:
                # payment line use credit
                Credit.create({
                    'name': statement_line.pos_statement_id.name,
                    'type': 'redeem',
                    'amount':  statement_line.amount,
                    'pos_order_id': statement_line.pos_statement_id.id,
                    'partner_id': statement_line.pos_statement_id.partner_id.id,
                })
            else:
                # change money of pos receipt
                Credit.create({
                    'name': statement_line.pos_statement_id.name,
                    'type': 'plus',
                    'amount': - statement_line.amount,
                    'pos_order_id': statement_line.pos_statement_id.id,
                    'partner_id': statement_line.pos_statement_id.partner_id.id,
                })
        return statement_line



