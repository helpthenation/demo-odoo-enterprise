# -*- coding: utf-8 -*-
from odoo import api, models, fields, registry
import logging
import json
import ast
import base64

_logger = logging.getLogger(__name__)


class pos_database(models.Model):
    _name = "pos.database"

    name = fields.Char('Name', required=1)
    database = fields.Binary(attachment=True, required=1)

    @api.model
    def load_master_data(self):
        databases = self.search([])
        if databases:
            return json.loads(base64.decodestring(databases[0].database).decode('utf-8'))
        else:
            return {}

    @api.model
    def save_master_data(self, datas):
        _logger.info('->>   save_master_data()')
        for product in datas['product.product']:
            results = []
            type_data = type(product['product_tmpl_id'])
            if type_data is list:
                self.env.cr.execute("select id,name from product_template where id=%s" % product['product_tmpl_id'][0])
                results = self.env.cr.fetchall()[0]
            if type_data == int:
                self.env.cr.execute("select id,name from product_template where id=%s" % product['product_tmpl_id'])
                results = self.env.cr.fetchall()[0]
            product['product_tmpl_id'] = [results[0], results[1]]
        datas = {
            'name': fields.Datetime.now(),
            'database': base64.encodestring(json.dumps(datas).encode('utf-8'))
        }
        self.env['pos.database'].create(datas)
        return True

    @api.model
    def refresh_caches(self):
        _logger.info('BEGIN refresh_caches')
        cache_model = self.env['pos.cache.database'].sudo()
        database = self.load_master_data()
        if not database:
            caches = cache_model.search_read(
                [], ['res_id', 'res_model', 'data', 'deleted'])
            caches_data = {}
            for cache in caches:
                if not caches_data.get(cache['res_model']):
                    model = cache['res_model']
                    caches_data[model] = {
                        'deleted': {},
                        'updated': {}
                    }
                if cache['deleted']:
                    caches_data[model]['deleted'][int(cache['res_id'])] = cache
                else:
                    caches_data[model]['updated'][int(cache['res_id'])] = cache
            for model, items in database.iteritems():
                _logger.info('BEGIN MERGING %s' % model)
                if caches_data.get(model):
                    new_items = []
                    item_exist = []
                    for item in items:
                        if caches_data.get(model).get('deleted').get(item['id']):
                            _logger.info('record remove out of cache')
                            continue
                        if caches_data.get(model).get('updated').get(item['id']):
                            data = caches_data.get(model).get('updated').get(item['id'])['data']
                            new_items.append(json.loads(data))
                        else:
                            new_items.append(item)
                        _logger.info('record exist in cache before')
                        item_exist.append(item['id'])
                    for record_id, value in caches_data.get(model).get('updated').iteritems():
                        if caches_data.get(model).get('updated').get(record_id, None) and record_id not in item_exist:
                            data = caches_data.get(model).get('updated').get(record_id, None)['data']
                            new_items.append(json.loads(data))
                            _logger.info('record doest not exist in cache before')
                    database[model] = new_items
            datas = {
                'database': base64.encodestring(json.dumps(database).encode('utf-8')),
            }
            self.env['pos.cache.database'].search([]).unlink()
            self.env['pos.database'].search([]).unlink()
            self.env['pos.database'].create(datas)
        return True




class pos_cache_database(models.Model):
    _name = "pos.cache.database"

    res_id = fields.Char('Id', required=1)
    res_model = fields.Char('Model')
    data = fields.Text('Data')
    deleted = fields.Boolean('Deleted', default=0)

    @api.multi
    def get_fields_by_model(self, model_name):
        params = self.env['ir.config_parameter'].sudo().get_param(model_name)
        if not params:
            list_fields = self.env[model_name].fields_get()
            fields_load = []
            for k, v in list_fields.items():
                if v['type'] not in ['one2many', 'binary']:
                    fields_load.append(k)
            return fields_load
        else:
            params = ast.literal_eval(params)
            return params.get('fields', [])

    @api.multi
    def get_domain_by_model(self, model_name):
        params = self.env['ir.config_parameter'].sudo().get_param(model_name)
        if not params:
            return []
        else:
            params = ast.literal_eval(params)
            return params.get('domain', [])

    def sync_to_pos(self, data):
        if data['model'] == 'product.product':
            data['price'] = data['list_price']
        sessions = self.env['pos.session'].sudo().search([
            ('state', '=', 'opened')
        ])
        self.env.cr.execute(
            "insert into pos_cache_database (res_id, res_model, data, deleted) VALUES (%s, %s, %s, %s)",
            (data['id'], data['model'], json.dumps(data), False,))
        for session in sessions:
            self.env['bus.bus'].sendmany(
                [[(self.env.cr.dbname, 'pos.sync.data', session.user_id.id), data]])
        return True

    @api.model
    def remove_record(self, data):
        _logger.info('BEGIN remove_record')
        self.env.cr.execute(
            "insert into pos_cache_database (res_id, res_model, data, deleted) VALUES (%s, %s, %s, %s)",
            (data['id'], data['model'], json.dumps(data), True,))
        sessions = self.env['pos.session'].sudo().search([
            ('state', '=', 'opened')
        ])
        for session in sessions:
            self.env['bus.bus'].sendmany(
                [[(self.env.cr.dbname, 'pos.sync.data', session.user_id.id), data]])
        return True

    @api.model
    def save_parameter_models_load(self, model_datas):
        # when pos loaded, all params (model name, fields list, context dict will store to backend
        # and use for cache data loaded to pos
        _logger.info('{store_pos_models} start')
        set_param = self.env['ir.config_parameter'].sudo().set_param
        for model_name, value in model_datas.items():
            _logger.info('{store_pos_models} set_param model_name %s' % model_name)
            set_param(model_name, value)
        _logger.info('{store_pos_models} end')
        return True

    def get_all_stock_by_stock_id(self, stock_location_id, stock_location_ids=[]):
        stock_location_ids = stock_location_ids
        stock_location_ids.append(stock_location_id)
        stock = self.env['stock.location'].browse(stock_location_id)
        for stock in stock.child_ids:
            stock_location_ids.append(stock.id)
            if stock.child_ids:
                self.get_all_stock_by_stock_id(stock.id, stock_location_ids)
        if len(stock_location_ids) == 1:
            stock_location_ids.append(0)
        return stock_location_ids

    @api.model
    def get_product_available_all_stock_location(self, stock_location_id):
        _logger.info('{get_product_available_all_stock_location}')
        sql = """
        with
          uitstock as (
          select
              t.name product, sum(product_qty) sumout, m.product_id, m.product_uom 
            from stock_move m 
              left join product_product p on m.product_id = p.id 
              left join product_template t on p.product_tmpl_id = t.id
            where
              m.state like 'done' 
              and m.location_id in (select id from stock_location where usage like 'internal') 
              and m.location_dest_id not in (select id from stock_location where usage like 'internal') 
            group by product_id,product_uom, t.name order by t.name asc
          ),
          instock as (
            select
              t.list_price purchaseprice, t.name product, sum(product_qty) sumin, m.product_id, m.product_uom
            from stock_move m
              left join product_product p on m.product_id = p.id
              left join product_template t on p.product_tmpl_id = t.id
            where 
              m.state like 'done' and m.location_id not in (select id from stock_location where usage like 'internal')
              and m.location_dest_id in (select id from stock_location where usage like 'internal')
            group by product_id,product_uom, t.name, t.list_price order by t.name asc
          ) 
        select
          i.product, sumin-coalesce(sumout,0) AS stock, sumin, sumout, purchaseprice, ((sumin-coalesce(sumout,0)) * purchaseprice) as stockvalue
        from uitstock u 
          full outer join instock i on u.product = i.product
        """

    @api.model
    def get_on_hand_by_stock_location(self, stock_location_id):
        stock_ids = self.get_all_stock_by_stock_id(stock_location_id, [])
        if len(stock_ids) > 1:
            stock_datas = self.get_product_available_filter_by_stock_location_ids(tuple(stock_ids))
        else:
            stock_datas = self.get_product_available_filter_by_stock_location_id(
                stock_location_id)
        if stock_datas == {}:
            return False
        else:
            return stock_datas


    @api.model
    def get_product_available_filter_by_stock_location_id(self, stock_location_id):
        _logger.info('{get_product_available_filter_by_stock_location_id}')
        sql = """
        with
            uitstock as (
                select
                  t.name product, sum(product_qty) sumout, m.product_id, m.product_uom 
                from stock_move m 
                left join product_product p on m.product_id = p.id 
                left join product_template t on p.product_tmpl_id = t.id
                where
                    m.state like 'done'
                    and t.type = 'product' 
                    and m.location_id in (select id from stock_location where id=%s) 
                    and m.location_dest_id not in (select id from stock_location where id=%s) 
                group by product_id,product_uom, t.name order by t.name asc
            ),
            instock as (
                select
                    t.list_price purchaseprice, t.name product, sum(product_qty) sumin, m.product_id, m.product_uom
                from stock_move m
                left join product_product p on m.product_id = p.id
                left join product_template t on p.product_tmpl_id = t.id
                where 
                    m.state like 'done' and m.location_id not in (select id from stock_location where id=%s)
                    and m.location_dest_id in (select id from stock_location where id=%s)
                group by product_id,product_uom, t.name, t.list_price order by t.name asc
          ) 
        select
          i.product_id, i.product, sumin-coalesce(sumout,0) AS stock, sumin, sumout, purchaseprice, ((sumin-coalesce(sumout,0)) * purchaseprice) as stockvalue
        from uitstock u 
          full outer join instock i on u.product = i.product
        """ % (stock_location_id, stock_location_id, stock_location_id, stock_location_id)
        self.env.cr.execute(sql)
        results = self.env.cr.fetchall()
        pos_data = {}
        for result in results:
            if result[0]:
                pos_data[result[0]] = result[2]
        return pos_data

    @api.model
    def get_product_available_filter_by_stock_location_ids(self, stock_location_ids):
        _logger.info('{get_product_available_filter_by_stock_location_ids}')
        sql = """
            with
                uitstock as (
                    select
                      t.name product, sum(product_qty) sumout, m.product_id, m.product_uom 
                    from stock_move m 
                    left join product_product p on m.product_id = p.id 
                    left join product_template t on p.product_tmpl_id = t.id
                    where
                        m.state like 'done'
                        and t.type = 'product' 
                        and m.location_id in (select id from stock_location where id in %s) 
                        and m.location_dest_id not in (select id from stock_location where id in %s)
                    group by product_id,product_uom, t.name order by t.name asc
                ),
                instock as (
                    select
                        t.list_price purchaseprice, t.name product, sum(product_qty) sumin, m.product_id, m.product_uom
                    from stock_move m
                    left join product_product p on m.product_id = p.id
                    left join product_template t on p.product_tmpl_id = t.id
                    where 
                        m.state like 'done' and m.location_id not in (select id from stock_location where id in %s)
                        and m.location_dest_id in (select id from stock_location where id in %s)
                    group by product_id,product_uom, t.name, t.list_price order by t.name asc
              ) 
            select
              i.product_id, i.product, sumin-coalesce(sumout,0) AS stock, sumin, sumout, purchaseprice, ((sumin-coalesce(sumout,0)) * purchaseprice) as stockvalue
            from uitstock u 
              full outer join instock i on u.product = i.product
            """ % (stock_location_ids, stock_location_ids, stock_location_ids, stock_location_ids)
        self.env.cr.execute(sql)
        results = self.env.cr.fetchall()
        pos_data = {}
        for result in results:
            if result[0]:
                pos_data[result[0]] = result[2]
        return pos_data

    @api.model
    def get_product_available_filter_by_stock_location_ids_and_product_id(self, stock_location_ids, product_id):
        _logger.info('{get_product_available_filter_by_stock_location_ids_and_product_id}')
        sql = """
                with
                    uitstock as (
                        select
                          t.name product, sum(product_qty) sumout, m.product_id, m.product_uom 
                        from stock_move m 
                        left join product_product p on m.product_id = p.id 
                        left join product_template t on p.product_tmpl_id = t.id
                        where
                            m.state like 'done'
                            and t.type = 'product' 
                            and m.location_id in (select id from stock_location where id in %s) 
                            and m.location_dest_id not in (select id from stock_location where id in %s)
                        group by product_id,product_uom, t.name order by t.name asc
                    ),
                    instock as (
                        select
                            t.list_price purchaseprice, t.name product, sum(product_qty) sumin, m.product_id, m.product_uom
                        from stock_move m
                        left join product_product p on m.product_id = p.id
                        left join product_template t on p.product_tmpl_id = t.id
                        where 
                            m.state like 'done' and m.location_id not in (select id from stock_location where id in %s)
                            and m.location_dest_id in (select id from stock_location where id in %s)
                        group by product_id,product_uom, t.name, t.list_price order by t.name asc
                  ) 
                select
                  i.product_id, i.product, sumin-coalesce(sumout,0) AS stock, sumin, sumout, purchaseprice, ((sumin-coalesce(sumout,0)) * purchaseprice) as stockvalue
                from uitstock u 
                  full outer join instock i on u.product = i.product
                where i.product_id=%s
                """ % (stock_location_ids, stock_location_ids, stock_location_ids, stock_location_ids, product_id)
        self.env.cr.execute(sql)
        results = self.env.cr.fetchall()
        pos_data = {}
        for result in results:
            if result[0]:
                pos_data[result[0]] = result[2]
        return pos_data
