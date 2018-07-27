odoo.define('pos_retail.big_data', function (require) {
    var models = require('point_of_sale.models');
    var core = require('web.core');
    var _t = core._t;
    var rpc = require('pos.rpc');
    var utils = require('web.utils');
    var round_pr = utils.round_precision;
    var ParameterDB = require('pos_retail.parameter');

    var _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        initialize: function (session, attributes) {
            this.next_load = 2000;
            this.model_lock = [];
            this.model_unlock = [];
            this.model_ids = session['model_ids'];
            for (var i = 0; i < this.models.length; i++) {
                if (this.models[i].model && this.model_ids[this.models[i].model]) {
                    this.models[i]['max_id'] = this.model_ids[this.models[i].model]['max_id'];
                    this.models[i]['min_id'] = this.model_ids[this.models[i].model]['min_id'];
                    this.model_lock.push(this.models[i]);
                } else {
                    this.model_unlock.push(this.models[i])
                }
            }
            var first_pricelist_model = _.find(this.models, function (model) {
                return model.model == 'product.pricelist' && model.first_load == true;
            })
            this.first_pricelist_model = first_pricelist_model;
            this.databases = session['databases'];
            this.models = this.model_unlock;
            this.stock_datas = session.stock_datas;
            this.caches = session.caches;
            if (this.caches && this.caches.length > 0 && this.databases) {
                for (var i = 0; i < this.caches.length; i++) {
                    var cache = this.caches[i];
                    var data = JSON.parse(cache['data']);
                    var id = parseInt(cache['res_id'])
                    var model = cache['res_model'];
                    var deleted = cache['deleted'];
                    var old_datas = this.databases[model];
                    var new_datas = _.filter(old_datas, function (old_data) {
                        return old_data['id'] != id;
                    })
                    this.databases[model] = new_datas;
                    if (deleted == true) {
                        this.databases[model] = new_datas;
                    } else {
                        this.databases[model].push(data);
                    }
                }
            }
            this.ParameterDB = new ParameterDB({});
            var config_id = this.ParameterDB.load(session.db + '_config_id');
            if (config_id) {
                var config_model = _.find(this.models, function (model) {
                    return model.model && model.model == "pos.config"
                })
                config_model.domain = [['id', '=', config_id]];
                this.config_id = config_id;
            }
            this.bus_logs = session.bus_logs;
            this.session = session;
            if (this.server_version == 10) {
                var currency_model = _.find(this.models, function (model) {
                    return model.model && model.model == "res.currency"
                })
                currency_model.ids = function (self) {
                    return [session.currency_id]
                }
            }
            return _super_PosModel.initialize.apply(this, arguments);
        },
        save_master_data: function () {
            this.chrome.loading_message(_t('Loaded done, saving database, waiting more few minutes'));
            var loaded = new $.Deferred();
            rpc.query({
                model: 'pos.database',
                method: 'save_master_data',
                args: [this.databases],
                context: {}
            }).then(function () {
                console.log('->> save_master_data() DONE')
                loaded.resolve();
            })
            return loaded
        },
        save_parameter_models_load: function () {
            /*
                Method store parameter load models to backend
             */
            var models = {};
            for (var number in this.model_lock) {
                var model = this.model_lock[number];
                models[model['model']] = {
                    fields: model['fields'] || [],
                    domain: model['domain'] || [],
                    context: model['context'] || [],
                };
                if (model['model'] == 'res.partner' || model['model'] == 'product.pricelist.item' || model['model'] == 'product.pricelist') {
                    models[model['model']]['domain'] = []
                }
                if (model['model'] == 'product.pricelist.item') {
                    models[model['model']]['domain'] = []
                }
            }
            rpc.query({
                model: 'pos.cache.database',
                method: 'save_parameter_models_load',
                args:
                    [models]
            }).then(function () {
                console.log('->> save_parameter_models_load() DONE')
            })
        },
        first_install: function (model_name) {
            var loaded = new $.Deferred();
            var model = _.find(this.model_lock, function (model) {
                return model.model == model_name;
            })
            if (!model) {
                return loaded.resolve();
            }
            var self = this;
            var tmp = {};
            var fields = model.fields;
            var context = model.context || {};

            function load_data(min_id, max_id) {
                var domain = [['id', '>=', min_id], ['id', '<', max_id]];
                console.log('->>>  Loading: ' + model['model'] + ' >= ' + min_id + ' to < ' + max_id);
                if (model['model'] == 'product.product') {
                    domain.push(['available_in_pos', '=', true]);
                    var price_id = null;
                    if (self.pricelist) {
                        price_id = self.pricelist.id;
                    }
                    var stock_location_id = null;
                    if (self.config.stock_location_id) {
                        stock_location_id = self.config.stock_location_id[0]
                    }
                    context = {
                        location: stock_location_id,
                        pricelist: price_id,
                        display_default_code: false
                    }
                }
                var params = {
                    model: model.model,
                    method: 'search_read',
                    domain: domain,
                    fields: fields,
                    context: context
                };
                return rpc.query(params).then(function (results) {
                    if (!self.databases) {
                        self.databases = {};
                    }
                    if (!self.databases[model['model']]) {
                        self.databases[model['model']] = [];
                    }
                    self.databases[model['model']] = self.databases[model['model']].concat(results);
                    min_id += self.next_load;
                    max_id += self.next_load;
                    if (results.length > 0) {
                        var percent = round_pr(min_id / model['max_id'] * 100, 0.001);
                        if (percent > 100) {
                            percent = 100;
                        }
                        self.chrome.loading_message(_t('Only one time installing: ') + model['model'] + ' ' + percent.toFixed(2) + ' % ');
                        load_data(min_id, max_id);
                        if (model.model == 'product.pricelist' && self.first_pricelist_model) {
                            return $.when(self.first_pricelist_model.loaded(self, results, tmp)).then(function () {
                            }, function (err) {
                                loaded.reject(err);
                            })
                        } else {
                            return $.when(model.loaded(self, results, tmp)).then(function () {
                            }, function (err) {
                                loaded.reject(err);
                            })
                        }
                    } else {
                        if (max_id < model['max_id']) {
                            load_data(min_id, max_id);
                        } else {
                            loaded.resolve();
                        }
                    }
                }).fail(function (type, error) {
                    self.chrome.loading_message(_t('Could not install database, Odoo server offline or your internet have problem. Please clean cache and reload '));
                });
            }

            load_data(model['min_id'], model['min_id'] + this.next_load);
            return loaded;
        },
        load_server_data: function () {
            var self = this;
            return _super_PosModel.load_server_data.apply(this, arguments).then(function () {
                for (var model_name in self.model_lock) {
                    self.models.push(self.model_lock[model_name]);
                }
                var session_info = self.session;
                var stock_datas = session_info['stock_datas'];
                /*
                    When updated done, i remove all cache changes of backend filter by pos config id
                */
                if (self.databases && self.databases['product.product']) {
                    for (var i = 0; i < self.model_lock.length; i++) {
                        var model = self.model_lock[i];
                        if (model.model == 'product.pricelist' || model.model == 'product.pricelist.item') {
                            var datas = self.databases[model.model];
                            model.loaded(self, datas, {});
                        }
                    }
                    for (var model_name in self.model_lock) {
                        if (model_name == 'product.pricelist' || model_name == 'product.pricelist.item') {
                            continue;
                        }
                        var model = self.model_lock[model_name];
                        var datas = self.databases[model.model];
                        if (model.model == 'product.product') {
                            self.products = datas;
                            for (var i = 0; i < datas.length; i++) {
                                var product = datas[i];
                                if (stock_datas[product['id']]) {
                                    product['qty_available'] = stock_datas[product['id']]
                                }
                            }
                        }
                        model.loaded(self, datas, {});
                    }
                } else {
                    return $.when(self.first_install('product.pricelist')).then(function () {
                        return $.when(self.first_install('product.pricelist.item')).then(function () {
                            return $.when(self.first_install('product.product')).then(function () {
                                return $.when(self.first_install('res.partner')).then(function () {
                                    return $.when(self.first_install('account.invoice')).then(function () {
                                        return $.when(self.first_install('account.invoice.line')).then(function () {
                                            return $.when(self.first_install('pos.order')).then(function () {
                                                return $.when(self.first_install('pos.order.line')).then(function () {
                                                    return $.when(self.first_install('sale.order')).then(function () {
                                                        return $.when(self.first_install('sale.order.line')).then(function () {
                                                            return $.when(self.save_master_data()).then(function () {
                                                                return true
                                                            });
                                                        })
                                                    })
                                                })
                                            })
                                        })

                                    })
                                })
                            })
                        })
                    })
                }
            }).then(function () {
                console.log(' **** START POS **** ');
                self.save_parameter_models_load();
                if (self.config.keyboard_new_order) { // keyboard
                    hotkeys(self.config.keyboard_new_order, function (event, handler) {
                        self.add_new_order();
                    });
                }
                if (self.config.keyboard_remove_order) { // keyboard
                    hotkeys(self.config.keyboard_remove_order, function (event, handler) {
                        var order = self.get_order();
                        if (!order) {
                            return;
                        } else if (!order.is_empty()) {
                            self.gui.show_popup('confirm', {
                                'title': _t('Destroy Current Order ?'),
                                'body': _t('You will lose any data associated with the current order'),
                                confirm: function () {
                                    self.delete_current_order();
                                },
                            });
                        } else {
                            self.delete_current_order();
                        }
                    });
                }
                rpc.query({
                    model: 'pos.config',
                    method: 'search_read',
                    domain: [['user_id', '!=', null]],
                    fields: [],
                }).then(function (configs) {
                    self.config_by_id = {};
                    self.configs = configs;
                    for (var i = 0; i < configs.length; i++) {

                        var config = configs[i];
                        self.config_by_id[config['id']] = config;
                    }
                    ;
                    if (self.config_id) {
                        var config = _.find(configs, function (config) {
                            return config['id'] == self.config_id
                        })
                        if (config) {
                            var user = self.user_by_id[config.user_id[0]]
                            if (user) {
                                self.set_cashier(user);
                            }
                        }
                    }
                });
                return rpc.query({
                    model: 'res.currency',
                    method: 'search_read',
                    fields: ['id', 'name', 'rounding', 'rate'],
                }).then(function (currencies) {
                    self.currency_by_id = {};
                    self.currencies = currencies;
                    var i = 0
                    while (i < currencies.length) {
                        self.currency_by_id[currencies[i].id] = currencies[i];
                        i++
                    }
                    var cashregisters = self.cashregisters;
                    for (var i = 0; i < cashregisters.length; i++) {
                        var cashregister = cashregisters[i];
                        var currency = self.currency_by_id[cashregister['currency_id'][0]];
                        if (cashregister['currency_id'] && cashregister['currency_id'][0] && currency && currency['rate']) {
                            cashregister['rate'] = currency['rate']
                        }
                    }
                })
            })
        }
    });
});
