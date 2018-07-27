"use strict";
odoo.define('pos_retail.screens', function (require) {

    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var utils = require('web.utils');
    var round_pr = utils.round_precision;
    var _t = core._t;
    var gui = require('point_of_sale.gui');
    var rpc = require('pos.rpc');
    var qweb = core.qweb;

    var TablesScreenWidget = screens.ScreenWidget.extend({
        template: 'TableScreenWidget',
        init: function (parent, options) {
            this._super(parent, options);
        },
        start: function () {
            var self = this;
            this._super();
            this.pos.bind('update:table-list', function () {
                self.renderElement();
            })
        },
        renderElement: function () {
            var self = this;
            this._super();
            var orders = this.pos.get('orders').models;
            var current_order = this.pos.get('selectedOrder');
            for (var i = 0; i < orders.length; i++) {
                var table = orders[i].table;
                if (table) {
                    var tablewidget = $(qweb.render('Table', {
                        widget: this,
                        table: table,
                    }));
                    tablewidget.data('id', table.id);
                    this.$('.table-items').append(tablewidget);
                    if (current_order) {
                        if (current_order.uid == orders[i].uid) {
                            tablewidget.css('background', 'rgb(110,200,155)');
                        }
                    }
                }
            }
            this.$('.table-item').on('click', function () {
                var table_id = parseInt($(this).data()['id']);
                self.clickTable(table_id);
                $(this).css('background', 'rgb(110,200,155)');
            });
        },
        get_order_by_table: function (table) {
            var orders = this.pos.get('orders').models;
            var order = orders.find(function (order) {
                if (order.table) {
                    return order.table.id == table.id;
                }
            });
            return order;
        },
        clickTable: function (table_id) {
            var self = this;
            var tables = self.pos.tables_by_id;
            var table = tables[table_id];
            if (table) {
                var order_click = this.get_order_by_table(table)
                if (order_click) {
                    this.pos.set('selectedOrder', order_click);
                    order_click.trigger('change', order_click);
                }
            }
            var items = this.$('.table-item');
            for (var i = 0; i < items.length; i++) {
                if (parseInt($(items[i]).data()['id']) != table_id) {
                    $(items[i]).css('background', '#fff');
                }
            }
        }
    });

    screens.ClientListScreenWidget.include({
        start: function () {
            var self = this;
            this._super();
            if (this.pos.config.keyboard_search) { // keyboard
                hotkeys(this.pos.config.keyboard_search, function (event, handler) {
                    var search_box = self.el.querySelector('.searchbox input');
                    if (search_box) {
                        search_box.value = '';
                        search_box.focus();
                    }
                });
            }
            this.pos.bind('update:point-client', function () {
                var partners = self.pos.db.get_partners_sorted(1000);
                self.re_render_list(partners);
            });
            this.pos.bind('sync:partner', function (customer_data) {
                if (customer_data) {
                    var partner_exist = false;
                    for (var i = 0; i < self.pos.partners.length; i++) {
                        var partner = self.pos.partners[i];
                        if (partner['id'] == customer_data['id']) {
                            partner = customer_data;
                            self.pos.db.partner_by_id[customer_data['id']] = null; // set null because odoo cache by id, if have data partner_by_id, odoo will continue loop
                            self.pos.db.add_partners([customer_data]);
                            partner_exist = true;
                        }
                    }
                    if (partner_exist == false) {
                        self.pos.partners.push(customer_data);
                        self.pos.db.add_partners([customer_data]);
                    }
                    var partners = self.pos.db.get_partners_sorted();
                    var orders = self.pos.get('orders').models;
                    for (var i = 0; i < orders.length; i++) {
                        var order = orders[i].export_as_JSON();
                        if (order['partner_id'] && order['partner_id'] == customer_data['id']) {
                            var client = self.pos.db.get_partner_by_id(customer_data['id']);
                            try {
                                orders[i].set_client(client);
                            } catch (ex) {
                                console.log('order just created at backend, no need set client()')
                            }
                        }
                    }
                    self.partner_cache = new screens.DomCache();
                    self.render_list(partners);
                }
            })
        },
        re_render_list: function (partners) {
            var contents = this.$el[0].querySelector('.client-list-contents');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(partners.length, 1000); i < len; i++) {
                var partner = partners[i];
                var clientline_html = qweb.render('ClientLine', {widget: this, partner: partners[i]});
                var clientline = document.createElement('tbody');
                clientline.innerHTML = clientline_html;
                clientline = clientline.childNodes[1];
                this.partner_cache.cache_node(partner.id, clientline);
                if (partner === this.old_client) {
                    clientline.classList.add('highlight');
                } else {
                    clientline.classList.remove('highlight');
                }
                contents.appendChild(clientline);
            }
        },
        show: function () {
            var self = this;
            this._super();
            var $search_box = $('.clientlist-screen .searchbox >input');
            $search_box.autocomplete({
                source: this.pos.db.partners_autocomplete,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var partner = self.pos.db.partner_by_id[parseInt(ui['item']['value'])];
                        if (partner) {
                            self.pos.get_order().set_client(partner);
                            self.pos.gui.back();
                        }
                        setTimeout(function () {
                            self.clear_search();
                        }, 10);
                    }
                }
            });
        }
    });

    screens.NumpadWidget.include({
        renderElement: function () {
            var self = this;
            this._super();
            $('.show_hide_pads').click(function () {
                if (!self.pos.hide_pads || self.pos.hide_pads == false) {
                    $('.show_hide_buttons').click();
                    $('.actionpad').animate({height: 0}, 'slow');
                    $('.numpad').animate({height: 0}, 'slow');
                    $('.show_hide_pads').toggleClass('fa-caret-down fa-caret-up');
                    for (var i = 0; i < self.gui.screen_classes.length; i++) {
                        var classe = self.gui.screen_classes[i];
                        if (classe['name'] && classe['name'] == 'payment') {
                            var payment_screen = new classe.widget(self, {});
                            payment_screen.appendTo($('.rightpane .content-row'));
                            $('.rightpane .quickly_buttons').addClass('oe_hidden');
                            $('.rightpane .content-cell').addClass('oe_hidden');
                            $('.rightpane .categories').addClass('oe_hidden');
                            $('.rightpane .right-content').animate({scrollTop: '0px'}, 0);
                            $('.payment-screen .back').remove();
                            $('.payment-screen .button_left').css({'left': '0px'});
                            $('.payment-screen .button_bottom').css({'left': '200px'});
                            $('.rightpane .right-content').animate({scrollTop: '0px'}, 0);
                            $('.breadcrumbs').addClass('oe_hidden');
                        }
                    }
                    self.pos.hide_pads = true;
                } else {
                    $('.show_hide_buttons').click();
                    $('.breadcrumbs').removeClass('oe_hidden');
                    $('.actionpad').animate({height: '100%'}, 'slow');
                    $('.numpad').animate({height: '100%'}, 'slow');
                    $('.show_hide_pads').toggleClass('fa-caret-down fa-caret-up');
                    $('.button .back').removeClass('oe_hidden');
                    $('.rightpane .payment-screen').remove();
                    $('.rightpane .quickly_buttons').removeClass('oe_hidden');
                    $('.rightpane .content-cell').removeClass('oe_hidden');
                    $('.payment-screen .back').removeClass('oe_hidden');
                    $('.breadcrumbs').removeClass('oe_hidden');
                    $('.rightpane .categories').removeClass('oe_hidden');
                    self.pos.hide_pads = false;
                }
            });
        },
        start: function () {
            var self = this;
            this._super();
            if (this.pos.config.keyboard_price) {
                hotkeys(this.pos.config.keyboard_price, function (event, handler) {
                    self.state.changeMode('price');

                });
            }
            if (this.pos.config.keyboard_quantity) {
                hotkeys(this.pos.config.keyboard_quantity, function (event, handler) {
                    self.state.changeMode('quantity');

                });
            }
            if (this.pos.config.keyboard_discount) {
                hotkeys(this.pos.config.keyboard_discount, function (event, handler) {
                    self.state.changeMode('discount');
                });
            }
        },
    });

    screens.ProductScreenWidget.include({
        init: function () {
            var self = this;
            this._super.apply(this, arguments);
        },
        start: function () {
            this._super();
            var action_buttons = this.action_buttons;
            for (var key in action_buttons) {
                action_buttons[key].appendTo(this.$('.button-list'));
            }
            this.$('.control-buttons').addClass('oe_hidden');
        },
        show: function () {
            var self = this;
            this._super();
            if (this.pos.config.keyboard_search) {
                hotkeys(this.pos.config.keyboard_search, function (event, handler) {
                    var search_box = self.el.querySelector('.rightpane-header .searchbox input');
                    if (search_box) {
                        search_box.value = '';
                        search_box.focus();
                    }
                });
            }
            if (this.pos.config.keyboard_payment) {
                hotkeys(this.pos.config.keyboard_payment, function (event, handler) {
                    self.$('.pay').click();
                });
            }
            if (this.pos.config.keyboard_add_client) {
                hotkeys(this.pos.config.keyboard_add_client, function (event, handler) {
                    self.$('.set-customer').click();
                });
            }
            // -------------------------------
            // quickly add product
            // quickly add customer
            // quickly payment
            // -------------------------------
            this.$('.add_customer').click(function () { // quickly add customer
                self.pos.gui.show_popup('popup_create_customer', {
                    title: 'Add customer',
                    confirm: function () {
                        var fields = {};
                        $('.partner_input').each(function (idx, el) {
                            fields[el.name] = el.value || false;
                        });
                        if (!fields.name) {
                            return self.pos.gui.show_popup('alert_result', {
                                title: 'Error',
                                body: 'A Partner name is required'
                            });
                        }
                        if (this.uploaded_picture) {
                            fields.image = this.uploaded_picture.split(',')[1];
                        }
                        if (fields['partner_type'] == 'customer') {
                            fields['customer'] = true;
                        }
                        if (fields['partner_type'] == 'vendor') {
                            fields['supplier'] = true;
                        }
                        if (fields['partner_type'] == 'customer_and_vendor') {
                            fields['customer'] = true;
                            fields['supplier'] = true;
                        }
                        if (fields['property_product_pricelist']) {
                            fields['property_product_pricelist'] = parseInt(fields['property_product_pricelist'])
                        }
                        return rpc.query({
                            model: 'res.partner',
                            method: 'create',
                            args: [fields]
                        }).then(function (partner_id) {
                            console.log('{partner_id} created : ' + partner_id)
                        }, function (type, err) {
                            if (err.code && err.code == 200 && err.data && err.data.message && err.data.name) {
                                self.pos.gui.show_popup('alert_result', {
                                    title: err.data.name,
                                    body: err.data.message,
                                    timer: 3000
                                })
                            } else {
                                self.pos.gui.show_popup('alert_result', {
                                    title: 'Error',
                                    body: 'Odoo connection fail, could not save'
                                })
                            }
                        });

                    }
                })
            });
            this.$('.add_product').click(function () { // quickly add product
                self.pos.gui.show_popup('popup_create_product', {
                    title: 'Add product',
                    confirm: function () {
                        var fields = {};
                        $('.product_input').each(function (idx, el) {
                            fields[el.name] = el.value || false;
                        });
                        if (!fields.name) {
                            return self.pos.gui.show_popup('alert_result', {
                                title: 'Error',
                                body: 'A Product name is required'
                            });
                        }
                        if (this.uploaded_picture) {
                            fields.image = this.uploaded_picture.split(',')[1];
                        }
                        if (fields['pos_categ_id']) {
                            fields['pos_categ_id'] = parseInt(fields['pos_categ_id'])
                        }
                        return rpc.query({
                            model: 'product.product',
                            method: 'create',
                            args: [fields]
                        }).then(function (product_id) {
                            console.log('{product_id} created : ' + product_id)
                        }, function (type, err) {
                            if (err.code && err.code == 200 && err.data && err.data.message && err.data.name) {
                                self.pos.gui.show_popup('alert_result', {
                                    title: err.data.name,
                                    body: err.data.message,
                                    timer: 3000
                                })
                            } else {
                                self.pos.gui.show_popup('alert_result', {
                                    title: 'Error',
                                    body: 'Odoo connection fail, could not save'
                                })
                            }
                        });

                    }
                })
            });
            this.$('.quickly_payment').click(function () { // quickly payment
                if (!self.pos.config.quickly_payment_full_journal_id) {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Error',
                        body: 'Your pos config not set quickly payment journal'
                    })
                }
                var order = self.pos.get_order();
                if (order.orderlines.length == 0) {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Error',
                        body: 'Your order empty'
                    })
                }
                var paymentlines = order.get_paymentlines();
                for (var i = 0; i < paymentlines.length; i++) {
                    paymentlines[i].destroy();
                }
                var register = _.find(self.pos.cashregisters, function (register) {
                    return register['journal']['id'] == self.pos.config.quickly_payment_full_journal_id[0];
                });
                if (!register) {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Error',
                        body: 'Your config not add quickly payment method, please add before use'
                    })
                }
                var amount_due = order.get_due();
                order.add_paymentline(register);
                var selected_paymentline = order.selected_paymentline;
                selected_paymentline.set_amount(amount_due);
                order.initialize_validation_date();
                self.pos.push_order(order);
                self.pos.gui.show_screen('receipt');

            });
            // change view products
            this.$('.product_list').click(function () {
                self.pos.config.product_view = 'list';
                var product_list_widget = new screens.ProductListWidget(self, {
                    click_product_action: function (product) {
                        self.click_product(product);
                    },
                    product_list: self.pos.db.get_product_by_category(0)
                });
                product_list_widget.replace(self.$('.product-list-container'));
            })
            this.$('.product_box').click(function () {
                self.pos.config.product_view = 'box';
                var product_list_widget = new screens.ProductListWidget(self, {
                    click_product_action: function (product) {
                        self.click_product(product);
                    },
                    product_list: self.pos.db.get_product_by_category(0)
                });
                product_list_widget.replace(self.$('.product-list-container'));
            });
            this.$('.lock_session').click(function () {
                $('.pos-content').addClass('oe_hidden');
                return self.pos.gui.show_popup('popup_lock_session', {
                    title: 'Locked session',
                });
            });
            this.$('.clear_blank_order').click(function () {
                var orders = self.pos.get('orders');
                for (var i = 0; i < orders.models.length; i++) {
                    var order = orders.models[i];
                    if (order.orderlines.models.length == 0) {
                        order.destroy({'reason': 'abandon'});
                    }
                }
            });
            this.$('.daily_report').click(function () {
                self.pos.gui.show_screen('daily_report');
            });
            this.$('.print_receipt').click(function () {
                var order = self.pos.get_order();
                if (!order || order.orderlines.length == 0) {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Your Order blank'
                    });
                }
                if (self.pos.config.lock_order_printed_receipt) {
                    return self.pos.gui.show_popup('alert_confirm', {
                        title: _t('Are you want print receipt?'),
                        body: 'If POS-BOX(printer) is ready config IP, please check receipt at printer, else if POS-BOX and printer not ready will go to Receipt Screen',
                        confirmButtonText: 'Yes',
                        cancelButtonText: 'No, close',
                        confirm: function () {
                            var order = self.pos.get_order();
                            if (order) {
                                order['lock'] = true;
                                this.pos.lock_order();
                                this.pos.pos_bus.push_message_to_other_sessions({
                                    data: order.uid,
                                    action: 'lock_order',
                                    bus_id: this.pos.config.bus_id[0],
                                    order_uid: order['uid']
                                });
                                return self.pos.gui.show_screen('receipt_review');
                            }
                        }
                    });
                } else {
                    return self.pos.gui.show_screen('receipt_review');
                }
            });
            var $find_product_box = $('.product-screen .searchbox >input');
            $find_product_box.autocomplete({
                source: this.pos.db.products_autocomplete,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value'])
                        var product = self.pos.db.get_product_by_id(ui['item']['value']);
                    setTimeout(function () {
                        $('.product-screen .searchbox >input')[1].value = '';
                    }, 10);
                    if (product) {
                        return self.pos.get_order().add_product(product);
                    }

                }
            });
            var $find_customer_box = $('.find_customer >input');
            $find_customer_box.autocomplete({
                source: this.pos.db.partners_autocomplete,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var partner = self.pos.db.partner_by_id[parseInt(ui['item']['value'])];
                        if (partner) {
                            self.pos.get_order().set_client(partner);
                            setTimeout(function () {
                                var input = self.el.querySelector('.find_customer input');
                                input.value = '';
                                input.focus();
                            }, 10);

                        }
                    }
                }
            });

        }
    });

    screens.ActionButtonWidget.include({
        highlight: function (highlight) {
            this._super(highlight)
            if (highlight) {
                this.$el.addClass('btn-success');
            } else {
                this.$el.removeClass('btn-success');
            }
        },
        altlight: function (altlight) {
            this._super(altlight)
            if (altlight) {
                this.$el.addClass('btn-info');
            } else {
                this.$el.removeClass('btn-info');
            }
        }
    });

    screens.ProductListWidget.include({
        init: function (parent, options) {
            var self = this;
            this._super(parent, options);
            // bind action only for v10
            // we are only change price of items display, not loop and change all, lost many memory RAM
            this.pos.bind('product:change_price_list', function (products) {
                try {
                    var $products_element = $('.product .product-img .price-tag');
                    for (var i = 0; i < $products_element.length; i++) {
                        var element = $products_element[i];
                        var product_id = parseInt(element.parentElement.parentElement.dataset.productId);
                        var product = self.pos.db.product_by_id(product_id);
                        if (product) {
                            var product = products[i];
                            var $product_el = $("[data-product-id='" + product['id'] + "'] .price-tag");
                            $product_el.html(self.format_currency(product['price']) + '/' + product['uom_id'][1]);
                        }
                    }
                } catch (e) {
                }
            });
            this.pos.bind('sync:product', function (product_data) { // product list update screen
                // update database products auto complete
                self.pos.db.products_autocomplete = _.filter(self.pos.db.products_autocomplete, function (values) {
                    return values['value'] != product_data['id'];
                })
                var label = "";
                if (product_data['default_code']) {
                    label = '[' + product_data['default_code'] + ']'
                }
                if (product_data['barcode']) {
                    label = '[' + product_data['barcode'] + ']'
                }
                if (product_data['display_name']) {
                    label = '[' + product_data['display_name'] + ']'
                }
                if (product_data['description']) {
                    label = '[' + product_data['description'] + ']'
                }
                self.pos.db.products_autocomplete.push({
                    value: product_data['id'],
                    label: label
                })
                // trigger update data of product and change products screen
                // odoo version 10
                if (self.pos.server_version == 10) {
                    self.pos.db.add_products([product_data]);
                    self.pos.db.product_by_id[product_data['id']] = product_data;
                    self.product_cache.cache_node(product_data['id'], null);
                    var product_node = self.render_product(product_data);
                    product_node.addEventListener('click', self.click_product_handler);
                    var $product_el = $(".product-list " + "[data-product-id='" + product_data['id'] + "']");
                    if ($product_el.length > 0) {
                        $product_el.replaceWith(product_node);
                    }
                }
                // odoo version 11
                if (self.pos.server_version == 11) {
                    self.product_cache = new screens.DomCache();
                    self.pos.db.product_by_category_id = {};
                    self.pos.db.category_search_string = {};
                    self.pos.db.product_by_barcode = {};
                    var products = [];
                    for (var product_id in self.pos.db.product_by_id) {
                        var product = self.pos.db.product_by_id[product_id];
                        product['product_tmpl_id'] = [product['product_tmpl_id'], product['display_name']]
                        if (product['id'] != product_data['id']) {
                            products.push(product);
                        } else {
                            products.push(product_data)
                        }
                    }
                    // check new product add from backend
                    var product_exist = _.filter(products, function (product) {
                        return product['id'] == product_data['id'];
                    });
                    if (product_exist.length == 0) {
                        products.push(product_data)
                    }
                    self.pos.db.add_products(_.map(products, function (product) {
                        product.categ = _.findWhere(self.pos.product_categories, {'id': product.categ_id[0]});
                        return new models.Product({}, product);
                    }));
                    self.product_list = self.pos.db.get_product_by_category(0);
                    self.renderElement();
                }
            });
            this.mouse_down = false;
            this.moved = false;
            this.auto_tooltip;
            this.product_mouse_down = function (e) {
                if (e.which == 1) {
                    $('#info_tooltip').remove();
                    self.right_arrangement = false;
                    self.moved = false;
                    self.mouse_down = true;
                    self.touch_start(this.dataset.productId, e.pageX, e.pageY);
                }
            };
            this.product_mouse_move = function (e) {
                if (self.mouse_down) {
                    self.moved = true;
                }
            };
        },
        touch_start: function (product_id, x, y) {
            var self = this;
            console.log(self.moved)
            this.auto_tooltip = setTimeout(function () {
                if (self.moved == false) {
                    this.right_arrangement = false;
                    var product = self.pos.db.get_product_by_id(parseInt(product_id));
                    var inner_html = self.generate_html(product);
                    $('.product-list-container').prepend(inner_html);
                    $(".close_button").on("click", function () {
                        $('#info_tooltip').remove();
                    });
                }
            }, 30);
        },
        generate_html: function (product) {
            var self = this;
            var product_tooltip_html = qweb.render('product_tooltip', {
                widget: self,
                product: product,
                field_load_check: self.pos.db.field_load_check
            });
            return product_tooltip_html;
        },
        touch_end: function () {
            if (this.auto_tooltip) {
                clearTimeout(this.auto_tooltip);
            }
        },
        render_product: function (product) {
            if (this.pos.config.product_view == 'box') {
                return this._super(product)
            } else {
                if (this.pos.server_version == 10) {
                    var cached = this.product_cache.get_node(product.id);
                    if (!cached) {
                        var product_html = qweb.render('Product', {
                            widget: this,
                            product: product,
                            image_url: this.get_product_image_url(product),
                        });
                        var product_node = document.createElement('tbody');
                        product_node.innerHTML = product_html;
                        product_node = product_node.childNodes[1];
                        this.product_cache.cache_node(product.id, product_node);
                        return product_node;
                    }
                    return cached;
                }
                if (this.pos.server_version == 11) {
                    var current_pricelist = this._get_active_pricelist();
                    var cache_key = this.calculate_cache_key(product, current_pricelist);
                    var cached = this.product_cache.get_node(cache_key);
                    if (!cached) {
                        var product_html = qweb.render('Product', {
                            widget: this,
                            product: product,
                            pricelist: current_pricelist,
                            image_url: this.get_product_image_url(product),
                        });
                        var product_node = document.createElement('tbody');
                        product_node.innerHTML = product_html;
                        product_node = product_node.childNodes[1];
                        this.product_cache.cache_node(cache_key, product_node);
                        return product_node;
                    }
                    return cached;
                }
            }
        },
        renderElement: function () {
            if (this.pos.config.product_view == 'box') {
                this._super();
            } else {
                var el_str = qweb.render(this.template, {widget: this});
                var el_node = document.createElement('div');
                el_node.innerHTML = el_str;
                el_node = el_node.childNodes[1];

                if (this.el && this.el.parentNode) {
                    this.el.parentNode.replaceChild(el_node, this.el);
                }
                this.el = el_node;
                var list_container = el_node.querySelector('.product-list-contents');
                for (var i = 0, len = this.product_list.length; i < len; i++) {
                    var product_node = this.render_product(this.product_list[i]);
                    product_node.addEventListener('click', this.click_product_handler);
                    list_container.appendChild(product_node);
                }
            }
            if (this.pos.config.tooltip) {
                var caches = this.product_cache;
                for (var cache_key in caches.cache) {
                    var product_node = this.product_cache.get_node(cache_key);
                    product_node.addEventListener('click', this.click_product_handler);
                    product_node.addEventListener('mousedown', this.product_mouse_down);
                    product_node.addEventListener('mousemove', this.product_mouse_move);
                }
                $(".product-list-scroller").scroll(function (event) {
                    $('#info_tooltip').remove();
                });
            }
        },
        _get_active_pricelist: function () {
            var current_order = this.pos.get_order();
            var current_pricelist = this.pos.default_pricelist;
            if (current_order && current_order.pricelist) {
                return this._super()
            } else {
                return current_pricelist
            }
        }
    });
    screens.ScreenWidget.include({

        show: function () {
            var self = this;
            this._super();
            $('.pos-logo').replaceWith();
            this.pos.barcode_reader.set_action_callback({ // bind device scan return order
                'order': _.bind(self.barcode_order_return_action, self),
            });
            if (this.pos.config.is_customer_screen) {
                $('.layout-table').replaceWith();
                $('.buttons_pane').replaceWith();
                $('.collapsed').replaceWith();
                $('.leftpane').css("left", '60%');
                $('.leftpane').css("right", '0');
                $('.leftpane').css("width", '40%');
                $('.rightpane').css("right", '40%');
                $('.rightpane').css("left", '0');
                $('.rightpane').css("width", '60%');
                $('.order').css("max-width", "100%")
                $('.pos-logo').replaceWith();
                $('.username').replaceWith();
                $('.order-selector').replaceWith();
                $('.pos-branding').css("position", 'initial');
                $('.pos-rightheader').css("left", '92%')
                $('.pos-rightheader').css("right", 0)
                var image_url = window.location.origin + '/web/image?model=pos.config.image&field=image&id=';
                var images = self.pos.images;
                for (var i = 0; i < images.length; i++) {
                    images[i]['image_url'] = 'background-image:url(' + image_url + images[i]['id'] + ')';
                }
                var CustomerScreen = $(qweb.render('CustomerScreenWidget', {
                    widget: this,
                    images: self.pos.images,
                }));
                $('.rightpane').append(CustomerScreen);
                new Swiper('.gallery-top', {
                    spaceBetween: 10,
                    navigation: {
                        nextEl: '.swiper-button-next',
                        prevEl: '.swiper-button-prev',
                    },
                    autoplay: {
                        delay: self.pos.config.delay,
                        disableOnInteraction: false,
                    }
                });
                new Swiper('.gallery-thumbs', {
                    spaceBetween: 10,
                    centeredSlides: true,
                    slidesPerView: 'auto',
                    touchRatio: 0.2,
                    slideToClickedSlide: true,
                    autoplay: {
                        delay: self.pos.config.delay,
                        disableOnInteraction: false,
                    }
                });
            }
        },
        // multi scanner barcode
        // controller of barcode scanner
        // Please dont change this function because
        // 1) we're have multi screen and multi barcode type
        // 2) at each screen we're have difference scan and parse code
        // 3) default of odoo always fixed high priority for scan products
        barcode_product_action: function (code) {
            var current_screen = this.pos.gui.get_current_screen();
            if (current_screen && current_screen == 'return_products') {
                this.scan_return_product(code);
            }
            if (current_screen && current_screen == 'login_page') {
                this.scan_barcode_user(code);
            }
            if (current_screen != 'return_products' && current_screen != 'login_page') {
                return this._super(code)
            }
        },
        barcode_order_return_action: function (datas_code) {
            if (datas_code && datas_code['type']) {
                console.log('{scanner}' + datas_code.type);
            }
            if (datas_code.type == 'order') {
                var order = this.pos.db.order_by_ean13[datas_code['code']]
                var order_lines = this.pos.db.lines_by_order_id[order.id];
                if (!order_lines) {
                    this.barcode_error_action(datas_code);
                    return false;
                } else {
                    this.gui.show_popup('popup_return_pos_order_lines', {
                        order_lines: order_lines,
                        order: order
                    });
                    return true
                }
            }
        }
    });

    screens.ScaleScreenWidget.include({
        _get_active_pricelist: function () {
            var current_order = this.pos.get_order();
            var current_pricelist = this.pos.default_pricelist;
            if (current_order && current_order.pricelist) {
                return this._super()
            } else {
                return current_pricelist
            }
        }
    });
    screens.OrderWidget.include({
        init: function (parent, options) {
            var self = this;
            this.mouse_down = false;
            this.moved = false;
            this.auto_tooltip;
            this._super(parent, options);
            this.line_mouse_down_handler = function (event) {
                self.line_mouse_down(this.orderline, event);
            };
            this.line_mouse_move_handler = function (event) {
                self.line_mouse_move(this.orderline, event);
            };
        },
        // if config lock when print receipt
        // we'll lock order
        change_selected_order: function () {
            var res = this._super();
            var order = this.pos.get_order();
            if (order && order.lock && this.pos.config.lock_order_printed_receipt) {
                this.pos.lock_order();
            } else {
                this.pos.unlock_order();
            }
        },
        touch_start: function (product, x, y) {
            var self = this;
            this.auto_tooltip = setTimeout(function () {
                if (!self.moved) {
                    var inner_html = self.gui.screen_instances.products.product_list_widget.generate_html(product);
                    $('.product-screen').prepend(inner_html);
                    $(".close_button").on("click", function () {
                        $('#info_tooltip').remove();
                    });
                }
            }, 30);
        },
        touch_end: function () {
            if (this.auto_tooltip) {
                clearTimeout(this.auto_tooltip);
            }
        },
        line_mouse_down: function (line, event) {
            var self = this;
            if (event.which == 1) {
                $('#info_tooltip').remove();
                self.moved = false;
                self.mouse_down = true;
                self.touch_start(line.product, event.pageX, event.pageY);
            }
        },
        line_mouse_move: function (line, event) {
            var self = this;
            if (self.mouse_down) {
                self.moved = true;
            }

        },
        rerender_orderline: function (order_line) {
            try {
                this._super(order_line)
            } catch (e) {
                return null;
            }
        },
        render_orderline: function (orderline) {
            var self = this;
            var el_node = this._super(orderline);
            if (this.pos.config.tooltip) {
                el_node.addEventListener('mousedown', this.line_mouse_down_handler);
                el_node.addEventListener('mousemove', this.line_mouse_move_handler);
            }
            // -----------------------------
            // Add sale person to line
            // -----------------------------
            var el_add_sale_person = el_node.querySelector('.add_sale_person');
            if (el_add_sale_person) {
                el_add_sale_person.addEventListener('click', (function () {
                    var list = [];
                    for (var i = 0; i < self.pos.bus_locations.length; i++) {
                        var bus = self.pos.bus_locations[i];
                        list.push({
                            'label': bus['user_id'][1] + '/' + bus['name'],
                            'item': bus
                        })
                    }
                    if (list.length > 0) {
                        return self.pos.gui.show_popup('selection', {
                            title: _t('Select sale person'),
                            list: list,
                            confirm: function (bus) {
                                var user_id = bus['user_id'][0];
                                var user = self.pos.user_by_id[user_id];
                                orderline.set_sale_person(user);
                            },
                        });
                    } else {
                        return this.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Go to Retail (menu) / Shop locations / add sale admin'
                        });
                    }

                }.bind(this)));
            }
            // -----------------------------
            // Change unit of measure of line
            // -----------------------------
            var el_change_unit = el_node.querySelector('.change_unit');
            if (el_change_unit) {
                el_change_unit.addEventListener('click', (function () {
                    var order = self.pos.get_order();
                    var selected_orderline = order.selected_orderline;
                    if (order) {
                        if (selected_orderline) {
                            selected_orderline.change_unit();
                        } else {
                            return self.pos.gui.show_popup('alert_result', {
                                title: 'Warning',
                                body: 'Please select line',
                                confirm: function () {
                                    return self.gui.close_popup();
                                },
                                cancel: function () {
                                    return self.gui.close_popup();
                                }
                            });
                        }
                    } else {
                        return self.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Order Lines is empty',
                            timer: 2000,
                            confirm: function () {
                                return self.gui.close_popup();
                            },
                            cancel: function () {
                                return self.gui.close_popup();
                            }
                        });
                    }

                }.bind(this)));
            }
            // -----------------------------
            // Change combo of line
            // -----------------------------
            var el_change_combo = el_node.querySelector('.change_combo');
            if (el_change_combo) {
                el_change_combo.addEventListener('click', (function () {
                    var order = self.pos.get_order();
                    if (order) {
                        var selected_orderline = order.selected_orderline;
                        if (selected_orderline) {
                            selected_orderline.change_combo();
                        }
                    }
                }.bind(this)));
            }
            // -----------------------------
            // Add cross sale
            // -----------------------------
            var el_change_cross_selling = el_node.querySelector('.change_cross_selling');
            if (el_change_cross_selling) {
                el_change_cross_selling.addEventListener('click', (function () {
                    var order = self.pos.get_order();
                    if (order) {
                        var selected_orderline = order.selected_orderline;
                        if (selected_orderline) {
                            selected_orderline.change_cross_selling();
                        }
                    }
                }.bind(this)));
            }
            // -----------------------------
            // Add cross sale
            // -----------------------------
            var el_change_line_note = el_node.querySelector('.change_line_note');
            if (el_change_line_note) {
                el_change_line_note.addEventListener('click', (function () {
                    var order = self.pos.get_order();
                    if (order) {
                        var selected_orderline = order.selected_orderline;
                        if (selected_orderline) {
                            this.gui.show_popup('popup_add_order_line_note', {
                                title: _t('Add Note'),
                                value: selected_orderline.get_line_note(),
                                confirm: function (note) {
                                    selected_orderline.set_line_note(note);
                                }
                            });
                        }
                    }
                }.bind(this)));
            }
            // -----------------------------
            // Add tags
            // -----------------------------
            var el_change_tags = el_node.querySelector('.change_tags');
            if (el_change_tags) {
                el_change_tags.addEventListener('click', (function () {
                    var order = self.pos.get_order();
                    if (order) {
                        var selected_orderline = order.selected_orderline;
                        if (selected_orderline) {
                            return this.gui.show_popup('popup_selection_tags', {
                                selected_orderline: selected_orderline,
                                title: 'Add tags'
                            });
                        }
                    }
                }.bind(this)));
            }
            return el_node;
        },
        remove_orderline: function (order_line) {
            try {
                this._super(order_line);
            } catch (ex) {
                console.error(ex);
                return this.gui.show_popup('alert_result', {
                    title: 'Error',
                    body: ex,
                    timer: 5000,
                    confirm: function () {
                        return this.gui.close_popup();
                    },
                    cancel: function () {
                        return this.gui.close_popup();
                    }
                });
            }
        },
        set_value: function (val) {
            var self = this;
            var mode = this.numpad_state.get('mode');
            var order = this.pos.get_order();
            // limit discount by cashiers
            if (mode == 'discount' && this.pos.config.discount_limit && order != undefined && order.get_selected_orderline()) {
                this.gui.show_popup('number', {
                    'title': _t('Are you sure apply discount ?'),
                    'value': self.pos.config.discount_limit_amount,
                    'confirm': function (discount) {
                        if (discount > self.pos.config.discount_limit_amount) {
                            self.pos.gui.close_popup();
                            return self.gui.show_popup('alert_confirm', {
                                title: _t('Limit discount'),
                                body: 'You can not set discount bigger than ' + self.pos.config.discount_limit_amount + '. Please contact admin for upgrade limit discount',
                                confirmButtonText: 'Yes',
                                cancelButtonText: 'Close',
                                confirm: function () {
                                    self.pos.gui.close_popup();
                                },
                                cancel: function () {
                                    self.pos.gui.close_popup();
                                }
                            })
                        } else {
                            order.get_selected_orderline().set_discount(discount);
                        }
                    }
                });
            } else {
                // validate
                var order = this.pos.get_order();
                if (mode == 'quantity' && this.pos.config.validate_discount_change && order && order.get_selected_orderline) {
                    return this.pos.gui.show_popup('password', {
                        confirm: function (value) {
                            if (value != this.pos.user.pos_security_pin) {
                                return this.pos.gui.show_popup('alert_result', {
                                    title: 'Wrong',
                                    body: 'Password not correct, please check pos secuirty pin'
                                })
                            } else {
                                order.get_selected_orderline().set_quantity(val);
                            }
                        }
                    })
                }
                if (mode == 'discount' && this.pos.config.validate_discount_change && order && order.get_selected_orderline) {
                    return this.pos.gui.show_popup('password', {
                        confirm: function (value) {
                            if (value != this.pos.user.pos_security_pin) {
                                return this.pos.gui.show_popup('alert_result', {
                                    title: 'Wrong',
                                    body: 'Password not correct, please check pos secuirty pin'
                                })
                            } else {
                                order.get_selected_orderline().set_discount(val);
                            }
                        }
                    })
                }
                if (mode == 'price' && this.pos.config.validate_discount_change && order && order.get_selected_orderline) {
                    return this.pos.gui.show_popup('password', {
                        confirm: function (value) {
                            if (value != this.pos.user.pos_security_pin) {
                                return this.pos.gui.show_popup('alert_result', {
                                    title: 'Wrong',
                                    body: 'Password not correct, please check pos secuirty pin'
                                })
                            } else {
                                var selected_orderline = order.get_selected_orderline();
                                selected_orderline.price_manually_set = true;
                                selected_orderline.set_unit_price(val);
                            }
                        }
                    })
                }
                this._super(val);
            }
        },
        set_lowlight_order: function (buttons) {
            for (var button_name in buttons) {
                buttons[button_name].highlight(false);
            }
        },
        active_count_booked_orders: function () { // set count booked orders
            var $booked_orders = $('.booked_orders');
            if ($booked_orders) {
                var sale_orders = _.filter(this.pos.db.sale_orders, function (order) {
                    return order['book_order'] == true && (order['state'] == 'draft' || order['state'] == 'sent');
                });
                $booked_orders.text(sale_orders.length);
            }
        },
        active_button_create_sale_order: function (buttons, selected_order) { // active function create sale order
            if (buttons && buttons.button_create_sale_order) {
                if (selected_order && selected_order.get_client()) {
                    buttons.button_create_sale_order.highlight(true);
                } else {
                    buttons.button_create_sale_order.highlight(false);
                }
            }
        },
        active_button_combo: function (buttons, selected_order) { // active button set combo
            if (selected_order.selected_orderline && buttons && buttons.button_combo) {
                var is_combo = selected_order.selected_orderline.is_combo();
                buttons.button_combo.highlight(is_combo);
            }
        },
        active_button_combo_item_add_lot: function (buttons, selected_order) { // active button set combo
            if (selected_order.selected_orderline && buttons && buttons.button_combo_item_add_lot) {
                var has_combo_item_tracking_lot = selected_order.selected_orderline.has_combo_item_tracking_lot();
                buttons.button_combo_item_add_lot.highlight(has_combo_item_tracking_lot);
            }
        },
        active_internal_transfer_button: function (buttons, selected_order) { // active button set combo
            if (buttons && buttons.internal_transfer_button) {
                var active = selected_order.validation_order_can_do_internal_transfer();
                buttons.internal_transfer_button.highlight(active);
            }
        },
        active_button_booking_order: function (buttons, selected_order) { // active button set combo
            if (buttons.button_booking_order && selected_order.get_client()) {
                buttons.button_booking_order.highlight(true);
            }
            if (buttons.button_booking_order && !selected_order.get_client()) {
                buttons.button_booking_order.highlight(false);
            }
        },
        active_button_delivery_order: function (buttons, selected_order) { // active button set combo
            if (buttons.button_delivery_order && selected_order.delivery_address) {
                buttons.button_delivery_order.highlight(true);
            }
            if (buttons.button_delivery_order && !selected_order.delivery_address) {
                buttons.button_delivery_order.highlight(false);
            }
        },
        active_loyalty: function (buttons, selected_order) {
            var $loyalty_element = $(this.el).find('.summary .loyalty-information');
            var lines = selected_order.orderlines.models;
            if (!lines || lines.length == 0) {
                $loyalty_element.addClass('oe_hidden');
            } else {
                var client = selected_order.get_client();
                var $plus_point = this.el.querySelector('.plus_point');
                var $redeem_point = this.el.querySelector('.redeem_point');
                var $remaining_point = this.el.querySelector('.remaining_point');
                var $next_point = this.el.querySelector('.next_point')
                if (client) { // if not set client. We're no need build point
                    var plus_point = selected_order.build_plus_point();
                    plus_point = round_pr(plus_point, this.pos.currency.rounding);
                    var redeem_point = selected_order.build_redeem_point();
                    if ($plus_point) {
                        $plus_point.textContent = plus_point;
                    }
                    if ($redeem_point) {
                        $redeem_point.textContent = redeem_point;
                    }
                    var pos_loyalty_point = client['pos_loyalty_point'];
                    var remaining_point = pos_loyalty_point - redeem_point;
                    var next_point = remaining_point + plus_point;
                    if ($remaining_point) {
                        remaining_point = round_pr(remaining_point, this.pos.currency.rounding);
                        $remaining_point.textContent = remaining_point;
                    }
                    if ($next_point) {
                        next_point = round_pr(next_point, this.pos.currency.rounding);
                        $next_point.textContent = next_point;
                    }
                    selected_order.plus_point = plus_point;
                    selected_order.redeem_point = redeem_point;
                    if (client['pos_loyalty_point'] > redeem_point && buttons && buttons.reward_button) {
                        buttons.reward_button.highlight(true);
                    }
                    else if (client['pos_loyalty_point'] <= redeem_point && buttons && buttons.reward_button) {
                        buttons.reward_button.highlight(false);
                    }
                } else {
                    if ($plus_point && $redeem_point && $remaining_point && $next_point) {
                        $plus_point.textContent = '0';
                        $redeem_point.textContent = '0';
                        $remaining_point.textContent = '0';
                        $next_point.textContent = '0';
                    }
                }
            }
        },
        active_show_delivery_address: function (buttons, selected_order) {
            var $delivery_address = this.el.querySelector('.delivery_address');
            var $delivery_date = this.el.querySelector('.delivery_date');
            if ($delivery_address) {
                $delivery_address.textContent = selected_order['delivery_address'];
            }
            if ($delivery_date) {
                $delivery_date.textContent = selected_order['delivery_date'];
            }
        },
        active_button_create_purchase_order: function (buttons, selected_order) {
            if (buttons.button_create_purchase_order) {
                if (selected_order.orderlines.length > 0 && selected_order.get_client()) {
                    buttons.button_create_purchase_order.highlight(true);
                } else {
                    buttons.button_create_purchase_order.highlight(false);
                }

            }
        },
        active_button_change_unit: function (buttons, selected_order) {
            if (buttons.button_change_unit) {
                if (selected_order.selected_orderline && selected_order.selected_orderline.is_multi_unit_of_measure()) {
                    buttons.button_change_unit.highlight(true);
                } else {
                    buttons.button_change_unit.highlight(false);
                }

            }
        },
        active_button_add_variants: function (buttons, selected_order) {
            if (buttons.button_add_variants) {
                if (selected_order.selected_orderline && selected_order.selected_orderline.is_multi_variant()) {
                    buttons.button_add_variants.highlight(true);
                } else {
                    buttons.button_add_variants.highlight(false);
                }

            }
        },
        active_promotion: function (buttons, selected_order) {
            if (selected_order.orderlines && selected_order.orderlines.length > 0 && this.pos.config.promotion == true && this.pos.config.promotion_ids.length > 0) {
                var lines = selected_order.orderlines.models;
                var promotion_amount = 0;
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i]
                    if (line.promotion) {
                        promotion_amount += line.get_price_without_tax()
                    }
                }
                if (selected_order && this.el.querySelector('.promotion_amount')) {
                    this.el.querySelector('.promotion_amount').textContent = round_pr(promotion_amount, this.pos.currency.rounding);
                    selected_order.promotion_amount = round_pr(promotion_amount, this.pos.currency.rounding);
                }
                var active_promotion = selected_order.current_order_can_apply_promotion();
                var can_apply = active_promotion['can_apply'];
                if (buttons && buttons.button_promotion) {
                    buttons.button_promotion.highlight(can_apply);
                }
                var promotions_apply = active_promotion['promotions_apply'];
                if (promotions_apply.length) {
                    var promotion_recommend_customer_html = qweb.render('promotion_recommend_customer', {
                        promotions: promotions_apply
                    });
                    $('.promotion_recommend_customer').html(promotion_recommend_customer_html);
                    $('.add_promotions').click(function () {
                        selected_order.compute_promotion();
                    });
                    $('.remove_promotions').click(function () {
                        selected_order.remove_all_promotion_line();
                    });
                } else {
                    $('.promotion_recommend_customer').html(""); // hide element promotion
                    selected_order.remove_all_promotion_line(); // auto clean promotion lines if still on order lines
                }
            }
        },
        active_button_set_tags: function (buttons, selected_order) {
            if (buttons.button_set_tags) {
                if (selected_order.selected_orderline && selected_order.selected_orderline.is_has_tags()) {
                    buttons.button_set_tags.highlight(true);
                } else {
                    buttons.button_set_tags.highlight(false);
                }

            }
        },
        active_button_print_voucher: function (buttons, selected_order) {
            if (buttons.button_print_voucher) {
                if (this.pos.config.iface_print_via_proxy) {
                    buttons.button_print_voucher.highlight(true);
                } else {
                    buttons.button_print_voucher.highlight(false);
                }

            }
        },
        active_lock_unlock_order: function (buttons, selected_order) {
            if (buttons.button_lock_unlock_order) {
                if (selected_order['lock']) {
                    buttons.button_lock_unlock_order.highlight(true);
                    buttons.button_lock_unlock_order.$el.html('<i class="fa fa-lock" /> UnLock Order')
                } else {
                    buttons.button_lock_unlock_order.highlight(false);
                    buttons.button_lock_unlock_order.$el.html('<i class="fa fa-unlock" /> Lock Order')
                }

            }
        },
        active_button_global_discount: function (buttons, selected_order) {
            if (buttons.button_global_discount) {
                if (selected_order.selected_orderline && this.pos.config.discount_ids) {
                    buttons.button_global_discount.highlight(true);
                } else {
                    buttons.button_global_discount.highlight(false);
                }

            }
        },
        update_summary: function () {
            this._super();
            var self = this;
            var selected_order = this.pos.get_order();
            var buttons = this.getParent().action_buttons;
            if (selected_order && buttons) {
                this.active_count_booked_orders();
                this.active_button_create_sale_order(buttons, selected_order);
                this.active_button_combo(buttons, selected_order);
                this.active_button_combo_item_add_lot(buttons, selected_order);
                this.active_internal_transfer_button(buttons, selected_order);
                this.active_button_booking_order(buttons, selected_order);
                this.active_button_delivery_order(buttons, selected_order);
                this.active_loyalty(buttons, selected_order);
                this.active_show_delivery_address(buttons, selected_order);
                this.active_button_create_purchase_order(buttons, selected_order);
                this.active_button_change_unit(buttons, selected_order);
                this.active_promotion(buttons, selected_order);
                this.active_button_set_tags(buttons, selected_order);
                this.active_button_print_voucher(buttons);
                this.active_lock_unlock_order(buttons, selected_order);
                this.active_button_global_discount(buttons, selected_order);
                try { // try catch because may be customer not installed pos_restaurant
                    var changes = selected_order.hasChangesToPrint();
                    if (buttons && buttons.button_kitchen_receipt_screen) {
                        buttons.button_kitchen_receipt_screen.highlight(changes);
                    }
                } catch (e) {

                }
                $('.note_order').click(function () {
                    self.pos.gui.show_popup('textarea', {
                        title: _t('Note'),
                        value: selected_order.get_note(),
                        confirm: function (note) {
                            selected_order.set_note(note);
                            selected_order.trigger('change', selected_order);
                        }
                    });
                });
                $('.signature_order').click(function () {
                    self.pos.gui.show_popup('popup_order_signature', {
                        order: selected_order,
                        title: 'Sign order'
                    });
                });
                var $signature = $('.signature');
                if ($signature) {
                    $signature.attr('src', selected_order.get_signature());
                }
                var $note = this.el.querySelector('.order-note');
                if ($note) {
                    $note.textContent = selected_order.get_note();
                }
            }
        }
    });
    var vouchers_screen = screens.ScreenWidget.extend({
        template: 'vouchers_screen',

        init: function (parent, options) {
            this._super(parent, options);
            this.vouchers = options.vouchers;
        },
        show: function () {
            this._super();
            this.vouchers = this.pos.vouchers;
            this.render_vouchers();
            this.handle_auto_print();
        },
        handle_auto_print: function () {
            if (this.should_auto_print()) {
                this.print();
                if (this.should_close_immediately()) {
                    this.click_back();
                }
            } else {
                this.lock_screen(false);
            }
        },
        should_auto_print: function () {
            return this.pos.config.iface_print_auto;
        },
        should_close_immediately: function () {
            return this.pos.config.iface_print_via_proxy;
        },
        lock_screen: function (locked) {
            this.$('.back').addClass('highlight');
        },
        get_voucher_env: function (voucher) {
            var order = this.pos.get_order();
            var datas = order.export_for_printing();
            return {
                widget: this,
                pos: this.pos,
                order: order,
                datas: datas,
                voucher: voucher
            };
        },
        print_web: function () {
            window.print();
        },
        print_xml: function () {
            if (this.vouchers) {
                for (var i = 0; i < this.vouchers.length; i++) {
                    var voucher_xml = qweb.render('voucher_ticket_xml', this.get_voucher_env(this.vouchers[i]));
                    this.pos.proxy.print_receipt(voucher_xml);
                }
            }
        },
        print: function () {
            var self = this;
            if (!this.pos.config.iface_print_via_proxy) {
                this.lock_screen(true);
                setTimeout(function () {
                    self.lock_screen(false);
                }, 1000);

                this.print_web();
            } else {
                this.print_xml();
                this.lock_screen(false);
            }
        },
        click_back: function () {
            this.pos.gui.show_screen('products');
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back').click(function () {
                self.click_back();
            });
            this.$('.button.print').click(function () {
                self.print();
            });
        },
        render_change: function () {
            this.$('.change-value').html(this.format_currency(this.pos.get_order().get_change()));
        },
        render_vouchers: function () {
            var $voucher_content = this.$('.pos-receipt-container');
            var url_location = window.location.origin + '/report/barcode/EAN13/';
            $voucher_content.empty(); // reset to blank content
            if (this.vouchers) {
                for (var i = 0; i < this.vouchers.length; i++) {
                    this.vouchers[i]['url_barcode'] = url_location + this.vouchers[i]['code'];
                    $voucher_content.append(
                        qweb.render('voucher_ticket_html', this.get_voucher_env(this.vouchers[i]))
                    );
                }
            }
        }
    });
    gui.define_screen({name: 'vouchers_screen', widget: vouchers_screen});

    var invoices_screen = screens.ScreenWidget.extend({ // invoices screen
        template: 'invoices_screen',
        start: function () {
            var self = this;
            this._super();
            this.pos.bind('update:invoice', function () {
                self.render_screen();
            })
        },
        show: function () {
            var self = this;
            this.render_screen();
            this.invoice_selected = null;
            this._super();
            this.$('.invoice-list').delegate('.invoice-line', 'click', function (event) {
                self.invoice_select(event, $(this), parseInt($(this).data('id')));
            });
            this.$('.searchbox .search-invoice').click(function () {
                self.clear_search();
            });
            this.$('.invoices_open').click(function () {
                var invoices = _.filter(self.pos.db.invoices, function (invoice) {
                    return invoice.state == 'open';
                });
                if (invoices) {
                    var contents = self.$('.invoice-details-contents');
                    contents.empty();
                    return self.render_invoice_list(invoices);
                } else {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Your database have not any invoices state at Open'
                    })
                }

            })
            var invoices = [];
            for (var i = 0; i < this.pos.db.invoices.length; i++) {
                var invoice = this.pos.db.invoices[i];
                var partner = this.pos.db.get_partner_by_id(invoice.partner_id[0]);
                var label = invoice['number']
                if (invoice['name']) {
                    label += ', ' + invoice['name'];
                }
                if (partner['display_name']) {
                    label += ', ' + partner['display_name']
                }
                if (partner['email']) {
                    label += ', ' + partner['email']
                }
                if (partner['phone']) {
                    label += ', ' + partner['phone']
                }
                if (partner['mobile']) {
                    label += ', ' + partner['mobile']
                }
                invoices.push({
                    value: invoice['id'],
                    label: label
                })
            }
            var $search_box = $('.clientlist-screen .search-invoice >input');
            $search_box.autocomplete({
                source: invoices,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var invoice = self.pos.db.invoice_by_id[ui['item']['value']];
                        if (invoice) {
                            self.display_invoice_details(invoice);
                        }
                        self.clear_search();

                    }
                }
            });
        },
        invoice_select: function (event, $invoice, id) {
            var invoice = this.pos.db.get_invoice_by_id(id);
            this.$('.invoice-line').removeClass('highlight');
            this.$('.invoice-line').addClass('lowlight');
            $invoice.addClass('highlight');
            this.display_invoice_details(invoice);

        },

        display_invoice_details: function (invoice) {
            this.invoice_selected = invoice;
            var self = this;
            var contents = this.$('.invoice-details-contents');
            contents.empty();
            invoice.link = window.location.origin + "/web#id=" + invoice.id + "&view_type=form&model=account.invoice";
            contents.append($(qweb.render('invoice_detail', {widget: this, invoice: invoice})));
            var account_invoice_lines = this.pos.db.invoice_lines_by_invoice_id[invoice.id];
            if (account_invoice_lines) {
                var line_contents = this.$('.invoice_lines_detail');
                line_contents.empty();
                line_contents.append($(qweb.render('account_invoice_lines', {
                    widget: this,
                    account_invoice_lines: account_invoice_lines
                })));
            }
            this.$('.inv-print-invoice').click(function () { // print invoice
                self.chrome.do_action('account.account_invoices', {
                    additional_context: {
                        active_ids: [self.invoice_selected['id']]
                    }
                })
            });
            this.$('.inv-print-invoice-without-payment').click(function () { // print invoice without payment
                self.chrome.do_action('account.account_invoices_without_payment', {
                    additional_context: {
                        active_ids: [self.invoice_selected['id']]
                    }
                })
            });
            this.$('.inv-send-email').click(function () { // send email invoice to customer

            });

            this.$('.inv-register-payment').click(function () { // register payment invoice
                self.gui.show_popup('popup_invoice_register_payment', {
                    invoice: self.invoice_selected
                })
            });
            this.$('.inv-action_invoice_open').click(function () { // action inv open
                return rpc.query({
                    model: 'account.invoice',
                    method: 'action_invoice_open',
                    args: [self.invoice_selected['id']]
                }).then(function (result) {
                    var message = '<a class="so_link" target="_blank" href="' + window.location.origin + '/web#id=' + self.invoice_selected['id'] + '&view_type=form&model=account.invoice">';
                    message += self.invoice_selected['number'] + '(Click)</a>';
                    return self.gui.show_popup('alert_confirm', {
                        title: message,
                        body: 'Click open new tab review invoice',
                        confirmButtonText: 'Yes',
                        cancelButtonText: 'No',
                        confirm: function () {
                            self.pos.gui.close_popup();
                        },
                        cancel: function () {
                            self.pos.gui.close_popup();
                        }
                    });
                }).fail(function (type, error) {
                    self.gui.show_popup('notify_popup', {
                        title: 'ERROR',
                        from: 'top',
                        align: 'center',
                        body: 'Odoo server have problem',
                        color: 'danger',
                        timer: 2000
                    });
                });

            });
            this.$('.inv-add-credit-note').click(function () {
                self.gui.show_popup('popup_account_invoice_refund', {
                    invoice: self.invoice_selected,
                })
            });
            this.$('.inv-cancel').click(function () {
                self.gui.show_popup('popup_account_invoice_cancel', {
                    invoice: self.invoice_selected,
                })

            });
        },
        render_screen: function () {
            this.pos.invoice_selected = null;
            var self = this;
            if (this.pos.db.invoices.length) {
                this.render_invoice_list(this.pos.db.invoices);
            }
            var search_timeout = null;
            if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }
            this.$('.search-invoice input').on('keypress', function (event) {
                clearTimeout(search_timeout);
                var query = this.value;
                search_timeout = setTimeout(function () {
                    self.perform_search(query, event.which === 13);
                }, 70);
            });
            this.$('.searchbox .search-clear').click(function () {
                self.clear_search();
            });
            this.$('.back').click(function () {
                self.gui.show_screen('products');
            });
        },
        perform_search: function (query, associate_result) {
            if (query) {
                var invoices = this.pos.db.search_invoice(query);
                this.render_invoice_list(invoices);
            }
        },
        clear_search: function () {
            var contents = this.$('.invoice-details-contents');
            contents.empty();
            var invoices = this.pos.db.invoices;
            this.render_invoice_list(invoices);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
        partner_icon_url: function (id) {
            return '/web/image?model=res.partner&id=' + id + '&field=image_small';
        },
        render_invoice_list: function (invoices) {
            var contents = this.$el[0].querySelector('.invoice-list');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(invoices.length, 1000); i < len; i++) {
                var invoice = invoices[i];
                var invoice_html = qweb.render('invoice_row', {
                    widget: this,
                    invoice: invoice
                });
                invoice = document.createElement('tbody');
                invoice.innerHTML = invoice_html;
                invoice = invoice.childNodes[1];
                contents.appendChild(invoice);
            }
        }
    });
    gui.define_screen({name: 'invoices', widget: invoices_screen});

    // validation payment
    screens.ActionpadWidget.include({
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.pay').click(function () {
                if (self.pos.config.validate_payment) {
                    self.pos.gui.show_screen('products');
                    return self.pos.gui.show_popup('password', {
                        confirm: function (value) {
                            if (value != this.pos.user.pos_security_pin) {
                                return this.pos.gui.show_popup('alert_result', {
                                    title: 'Wrong',
                                    body: 'Password not correct, please check pos secuirty pin'
                                })
                            } else {
                                return this.pos.gui.show_screen('payment');
                            }
                        }
                    })
                }
            });
        }
    });

    var return_products = screens.ScreenWidget.extend({ // return products screen
        template: 'return_products',
        start: function () {
            this.products_return = [];
            this._super();
            this.render_screen();
        },
        show: function () {
            var self = this;
            this._super();
            var $search_box = $('.search_return_products >input');
            $search_box.autocomplete({
                source: this.pos.db.products_autocomplete,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var product_selected = self.pos.db.product_by_id[ui['item']['value']];
                        if (product_selected) {
                            self.add_product(product_selected);
                        }
                    }
                }
            });
        },
        scan_return_product: function (datas) {
            var product_selected = this.pos.db.product_by_barcode[datas['code']];
            if (product_selected) {
                this.add_product(product_selected);
                return true;
            } else {
                this.barcode_error_action(datas);
                return false;
            }
        },
        add_product: function (product_selected) { // method add products return
            var self = this;
            if (product_selected) {
                var product_exsit = _.find(this.products_return, function (product) {
                    return product['id'] == product_selected['id']
                });
                var products = _.filter(this.products_return, function (product) {
                    return product['id'] != product_selected['id']
                });
                if (product_exsit) {
                    if (!product_exsit['quantity_return']) {
                        product_exsit['quantity_return'] = 1
                    } else {
                        product_exsit['quantity_return'] += 1
                    }

                } else {
                    product_selected['quantity_return'] = 1;
                    products.push(product_selected);
                    this.products_return = products;
                }
                this.render_products_return();
                setTimeout(function () {
                    self.$('.searchbox input')[0].value = '';
                }, 10);
            }
        },

        render_screen: function () {
            this.pos.invoice_selected = null;
            var self = this;
            this.$('.back').click(function () {
                self.gui.show_screen('products');
            });
            var $confirm_return = this.$('.confirm_return');
            $confirm_return.click(function () {
                if (self.products_return.length <= 0) {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Lines list empty, please find products'
                    })
                }
                var $return_journal_id = $('#return_journal_id').val();
                var return_journal_id = parseInt($return_journal_id);
                var return_payment_register = _.find(self.pos.cashregisters, function (cashregister) {
                    return cashregister.journal['id'] == return_journal_id;
                });
                var order = self.pos.get_order();
                if (return_payment_register && order) {
                    order['is_return'] = true;
                    for (var i = 0; i < order.orderlines.models.length + 1; i++) {
                        order.remove_orderline(order.orderlines.models[i]);
                    }
                    for (var i = 0; i < order.paymentlines.models.length + 1; i++) {
                        order.paymentlines.remove(order.paymentlines.models[i]);
                    }
                    order.remove_orderline(order.orderlines.models[0]);
                    order.remove_orderline(order.orderlines.models[0]);
                    for (var i = 0; i < self.products_return.length; i++) {
                        var product = self.products_return[i];
                        var line = new models.Orderline({}, {pos: self.pos, order: order, product: product});
                        line['is_return'] = true;
                        order.orderlines.add(line);
                        var price_return = product['price_return'] || product['list_price'];
                        line.set_unit_price(price_return);
                        line.set_quantity(-product['quantity_return'], 'keep price when return');
                    }
                    var return_paymentline = new models.Paymentline({}, {
                        order: order,
                        cashregister: return_payment_register,
                        pos: self.pos
                    });
                    var amount = order.get_total_with_tax();
                    return_paymentline.set_amount(amount);
                    order.paymentlines.add(return_paymentline);
                    order.trigger('change', order);
                    return self.gui.show_screen('payment');
                } else {
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Return Mode not selected, please select again'
                    })
                }
            });
        },
        product_icon_url: function (id) {
            return '/web/image?model=product.product&id=' + id + '&field=image_small';
        },
        render_products_return: function () {
            var self = this;
            var contents = this.$el[0].querySelector('tbody');
            contents.innerHTML = "";
            for (var i = 0; i < this.products_return.length; i++) {
                var product = this.products_return[i];
                var product_html = qweb.render('product_return_row', {
                    widget: this,
                    product: product
                });
                product = document.createElement('tbody');
                product.innerHTML = product_html;
                product = product.childNodes[1];
                contents.appendChild(product);
            }
            $('.product_row .quantity').on('click', function () {
                var product_id = $(this).parent().parent().data()['id'];
                var product = _.find(self.products_return, function (product) {
                    return product['id'] == product_id;
                });
                var html = '<div class="form-group">' + '<input value="' + (product['qty_return'] || 0) + '" id="qty_return" type="number" class="form-control voucher" />' + '</div>'
                return self.pos.gui.show_popup('alert_input', {
                    title: _t('Quantity'),
                    html: html,
                    body: 'Please input quantity need return',
                    confirmButtonText: 'Yes',
                    cancelButtonText: 'No',
                    confirm: function () {
                        var $quantity_return = $('#qty_return').val();
                        var quantity_return = parseFloat($quantity_return);
                        var product = _.find(self.products_return, function (product) {
                            return product['id'] == product_id;
                        });
                        if (product) {
                            product['quantity_return'] = quantity_return;
                        }
                        self.render_products_return();
                    },
                    cancel: function () {

                    }
                })
            });
            $('.product_row .edit_amount').on('click', function () {
                var product_id = $(this).parent().parent().data()['id'];
                var product = _.find(self.products_return, function (product) {
                    return product['id'] == product_id;
                });
                var html = '<div class="form-group">' + '<input value="' + (product['price_return'] || 0) + '" id="price_return" type="number" class="form-control voucher" />' + '</div>'
                return self.pos.gui.show_popup('alert_input', {
                    title: _t('Amount return'),
                    html: html,
                    body: 'Please input amount',
                    confirmButtonText: 'Yes',
                    cancelButtonText: 'No',
                    confirm: function () {
                        var $price_return = $('#price_return').val();
                        var price_return = parseFloat($price_return);
                        var product = _.find(self.products_return, function (product) {
                            return product['id'] == product_id;
                        });
                        if (product) {
                            product['price_return'] = price_return;
                        }
                        self.render_products_return();
                    },
                    cancel: function () {

                    }
                })
            });
            $('.product_row .remove').on('click', function () {
                var product_id = $(this).parent().parent().data()['id'];
                var products = _.filter(self.products_return, function (product) {
                    return product['id'] !== product_id;
                });
                self.products_return = products;
                self.render_products_return();
            });
        }

    });
    gui.define_screen({name: 'return_products', widget: return_products});

    var daily_report = screens.ScreenWidget.extend({  // daily report screen
        template: 'daily_report',
        start: function () {
            this.user_id = null;
            this.line_selected = [];
            this._super();
        },
        show: function () {
            var self = this;
            if (this.line_selected.length == 0) {
                this.line_selected = this.pos.db.pos_order_lines
            }
            this._super();
            this.$('.search-clear').click();
            this.$('.datetimepicker').datetimepicker({
                format: 'YYYY-MM-DD H:mm:00',
                icons: {
                    time: "fa fa-clock-o",
                    date: "fa fa-calendar",
                    up: "fa fa-chevron-up",
                    down: "fa fa-chevron-down",
                    previous: 'fa fa-chevron-left',
                    next: 'fa fa-chevron-right',
                    today: 'fa fa-screenshot',
                    clear: 'fa fa-trash',
                    close: 'fa fa-remove'
                }
            });
            var users = this.pos.users;
            var users_list = [];
            for (var i = 0; i < users.length; i++) {
                var user = users[i];
                var label = user.name;
                users_list.push({
                    value: user['id'],
                    label: label
                })
            }
            var $search_box = this.$('.search_user >input');
            $search_box.autocomplete({
                source: users_list,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var user_id = ui['item']['value'];
                        var user = self.pos.user_by_id[user_id];
                        self.line_selected = _.filter(self.pos.db.pos_order_lines, function (line) {
                            return line['create_uid'][0] == user_id;
                        });
                        self.$('.search_user input').value = user['display_name'];
                        var start_date = self.$('.start_date').val();
                        var end_date = self.$('.end_date').val();
                        self.$('.pos-receipt-container').empty();
                        if (start_date && end_date) {
                            self.line_selected = _.filter(self.line_selected, function (line) {
                                return line['create_date'] >= start_date && line['create_date'] <= end_date
                            })
                        }
                        self.user_id = user_id;

                        self.render_report();
                        setTimeout(function () {
                            var input = self.el.querySelector('.search_user input');
                            input.value = user['display_name'];
                            input.focus();
                        }, 500);
                    }
                }
            });
            var self = this;
            this.line_selected = this.pos.db.pos_order_lines;
            this.$('.back').click(function () {
                self.pos.gui.show_screen('products');

            });
            this.$('.search-clear').click(function () {
                self.user_id = null;
                self.line_selected = self.pos.db.pos_order_lines;
                var $start_date = self.el.querySelector('.start_date');
                $start_date.value = '';
                var $end_date = self.el.querySelector('.end_date');
                $end_date.value = '';
                var $search_user = self.el.querySelector('.search_user input');
                $search_user.value = '';
                self.render_report();
            });
            this.$('.start_date').blur(function () {
                self.line_selected = self.pos.db.pos_order_lines;
                var start_date = self.$(this).val();
                var end_date = self.$('.end_date').val();
                if (end_date) {
                    self.line_selected = _.filter(self.line_selected, function (line) {
                        return line['create_date'] >= start_date && line['create_date'] <= end_date;
                    })
                } else {
                    self.line_selected = _.filter(self.line_selected, function (line) {
                        return line['create_date'] >= start_date;
                    })
                }
                self.render_report();

            });
            this.$('.end_date').blur(function () {
                self.line_selected = self.pos.db.pos_order_lines;
                var start_date = self.$('.start_date').val();
                var end_date = self.$(this).val();
                if (start_date) {
                    self.line_selected = _.filter(self.line_selected, function (line) {
                        return line['create_date'] >= start_date && line['create_date'] <= end_date;
                    })
                } else {
                    self.line_selected = _.filter(self.line_selected, function (line) {
                        return line['end_date'] <= end_date;
                    })
                }
                self.render_report();
            });
            this.render_report();
        },
        product_icon_url: function (id) {
            return '/web/image?model=product.product&id=' + id + '&field=image_small';
        },
        render_report: function (print_xml) {
            var $daily_report = this.$('.pos-receipt-container');
            $daily_report.empty();
            var line_selected = this.line_selected;
            var orderlines_by_user_id = {};
            for (var i = 0; i < line_selected.length; i++) {
                var line = line_selected[i];
                if (!orderlines_by_user_id[line['create_uid'][0]]) {
                    orderlines_by_user_id[line['create_uid'][0]] = [line]
                } else {
                    orderlines_by_user_id[line['create_uid'][0]].push(line)
                }
            }
            var datas = [];
            var user_id;
            for (user_id in orderlines_by_user_id) {
                var user = this.pos.user_by_id[user_id];
                var orderlines = orderlines_by_user_id[user_id];
                var amount_total = 0;
                for (var i = 0; i < orderlines.length; i++) {
                    var line = orderlines[i];
                    amount_total += line['price_unit'] * line['qty']
                }
                if (user) {
                    datas.push({
                        user: user,
                        orderlines: orderlines,
                        amount_total: amount_total
                    })
                }
            }
            if (datas.length) {
                var report_html = qweb.render('daily_report_user_html', {
                    datas: datas,
                    pos: this.pos,
                    widget: this
                });
                $daily_report.html(report_html)
                if (print_xml) {
                    var report_xml = qweb.render('daily_report_user_xml', {
                        datas: datas,
                        pos: this.pos,
                        widget: this
                    });
                    this.pos.proxy.print_receipt(report_xml);
                }
            }
        }

    });
    gui.define_screen({name: 'daily_report', widget: daily_report});

    var kitchen_receipt_screen = screens.ScreenWidget.extend({
        template: 'kitchen_receipt_screen',
        show: function () {
            this._super();
            var self = this;
            this.render_receipt();
        },
        lock_screen: function (locked) {
            this._locked = locked;
            if (locked) {
                this.$('.next').removeClass('highlight');
            } else {
                this.$('.next').addClass('highlight');
            }
        },
        get_receipt_all_printer_render_env: function () {
            var order = this.pos.get_order();
            var printers = this.pos.printers;
            var item_new = [];
            var item_cancelled = [];
            var table = null;
            var floor = null;
            for (var i = 0; i < printers.length; i++) {
                var changes = order.computeChanges(printers[i].config.product_categories_ids);
                table = changes['table'];
                floor = changes['floor'];
                for (var i = 0; i < changes['new'].length; i++) {
                    item_new.push(changes['new'][i]);
                }
                for (var i = 0; i < changes['cancelled'].length; i++) {
                    item_cancelled.push(changes['cancelled'][i]);
                }
            }
            return {
                widget: this,
                table: table,
                floor: floor,
                new_items: item_new,
                cancelled_items: item_cancelled
            }
        },
        get_receipt_filter_by_printer_render_env: function (printer) {
            var order = this.pos.get_order();
            var item_new = [];
            var item_cancelled = [];
            var changes = order.computeChanges(printer.config.product_categories_ids);
            for (var i = 0; i < changes['new'].length; i++) {
                item_new.push(changes['new'][i]);
            }
            for (var i = 0; i < changes['cancelled'].length; i++) {
                item_cancelled.push(changes['cancelled'][i]);
            }
            return {
                widget: this,
                table: changes['table'] || null,
                floor: changes['floor'] || null,
                new_items: item_new,
                cancelled_items: item_cancelled,
                time: changes['time']
            }
        },
        print_web: function () {
            var self = this;
            this.lock_screen(true);
            setTimeout(function () {
                self.lock_screen(false);
            }, 1000);
            window.print();
        },
        click_back: function () {
            this.pos.gui.show_screen('products');
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back').click(function () {
                self.click_back();
            });
            this.$('.button.print-kitchen-receipt').click(function () {
                self.print_web();
            });
        },
        render_receipt: function () {
            var values = this.get_receipt_all_printer_render_env();
            this.$('.pos-receipt-container').html(qweb.render('kitchen_receipt', values));
            var printers = this.pos.printers;
            for (var i = 0; i < printers.length; i++) {
                var value = this.get_receipt_filter_by_printer_render_env(printers[i]);
                if (value['new_items'].length > 0 || value['cancelled_items'].length > 0) {
                    var receipt = qweb.render('kitchen_receipt_xml', value);
                    printers[i].print(receipt);
                }
                this.pos.get_order().saveChanges();
            }
        }
    });

    gui.define_screen({name: 'kitchen_receipt_screen', widget: kitchen_receipt_screen});

    // login page
    var login_page = screens.ScreenWidget.extend({
        template: 'login_page',
        login: function () {
            var pos_security_pin = this.$('.pos_security_pin').val();
            if (this.pos.user.pos_security_pin == false) {
                return this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Your account not set pos security pin, Please go to Setting / User and set pos pin',
                    timer: 5000
                });
            }
            if (pos_security_pin == this.pos.user.pos_security_pin) {
                $('.pos-topheader').removeClass('oe_hidden');
                this.$('.pos_security_pin').value = '';
                var default_screen = this.pos.default_screen;
                var startup_screen = this.gui.startup_screen;
                this.gui.set_default_screen(default_screen);
                this.gui.set_startup_screen(startup_screen);
                this.gui.show_screen(default_screen);
            } else {
                return this.gui.show_popup('alert_result', {
                    title: 'Wrong',
                    body: 'Wrong pos security pin, please check again'
                });
            }
        },
        show: function () {
            var self = this;
            $('#password').focus();
            this.$('.confirm-login').click(function () {
                self.login()
            });
            this.$('.confirm-logout').click(function () {
                self.gui._close();
            });
            $('.pos-topheader').addClass('oe_hidden');
            this.pos.barcode_reader.set_action_callback({
                'login_security': _.bind(self.scan_barcode_pos_security_pin, self)
            });
            this._super();
        },
        scan_barcode_pos_security_pin: function (datas) {
            var barcode = datas['code'];
            if (this.pos.user['barcode'] == barcode) {
                $('.pos-topheader').removeClass('oe_hidden');
                this.$('.pos_security_pin').value = '';
                var default_screen = this.pos.default_screen;
                var startup_screen = this.gui.startup_screen;
                this.gui.set_default_screen(default_screen);
                this.gui.set_startup_screen(startup_screen);
                this.gui.show_screen(default_screen);
                return true
            } else {
                this.barcode_error_action(datas);
                return false;
            }
        }
    });
    gui.define_screen({name: 'login_page', widget: login_page});

    var pos_orders_screen = screens.ScreenWidget.extend({ // pos orders screen
        template: 'pos_orders_screen',

        init: function (parent, options) {
            this._super(parent, options);
            this.pos_order_cache = new screens.DomCache();
        },

        show: function () {
            var self = this;
            this.render_screen();
            this._super();
            var search_timeout = null;
            var input = this.el.querySelector('.searchbox input');
            input.value = '';
            input.focus();
            this.render_pos_order_list(this.pos.db.orders_store);
            this.$('.client-list-contents').delegate('.pos_order_row', 'click', function (event) {
                self.order_select(event, $(this), parseInt($(this).data('id')));
            });
            var search_timeout = null;

            if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }

            this.$('.searchbox input').on('keypress', function (event) {
                clearTimeout(search_timeout);

                var searchbox = this;

                search_timeout = setTimeout(function () {
                    self.perform_search(searchbox.value, event.which === 13);
                }, 70);
            });
            this.$('.searchbox .search-clear').click(function () {
                self.clear_search();
            });
        },
        clear_search: function () {
            this.render_pos_order_list(this.pos.db.orders_store);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
        perform_search: function (query, associate_result) {
            var orders;
            if (query) {
                orders = this.pos.db.search_order(query);
                if (associate_result && orders.length === 1) {
                    return this.display_pos_order_detail(orders[0]);
                }
                return this.render_pos_order_list(orders);
            } else {
                orders = this.pos.db.orders_store;
                return this.render_pos_order_list(orders);
            }
        },
        render_screen: function () {
            this.pos.quotation_selected = null;
            var self = this;
            this.$('.back').click(function () {
                self.gui.show_screen('products');
            });
            var $search_box = $('.search-pos-order >input');
            if ($search_box) {
                $search_box.autocomplete({
                    source: this.pos.db.pos_orders_autocomplete,
                    minLength: this.pos.minLength,
                    select: function (event, ui) {
                        if (ui && ui['item'] && ui['item']['value']) {
                            var order = self.pos.db.order_by_id[ui['item']['value']];
                            self.display_pos_order_detail(order);
                            setTimeout(function () {
                                self.clear_search();
                            }, 1000);

                        }
                    }
                });
            }
        },
        partner_icon_url: function (id) {
            return '/web/image?model=res.partner&id=' + id + '&field=image_small';
        },
        order_select: function (event, $order, id) {
            var order = this.pos.db.order_by_id[id];
            $('.client-line').removeClass('highlight');
            $order.addClass('highlight');
            this.display_pos_order_detail(order);
            this.order_selected = order;
        },
        render_pos_order_list: function (orders) {
            var contents = this.$el[0].querySelector('.pos_order_list');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(orders.length, 1000); i < len; i++) {
                var order = orders[i];
                var pos_order_row = this.pos_order_cache.get_node(order.id);
                if (!pos_order_row) {
                    var pos_order_row_html = qweb.render('pos_order_row', {widget: this, order: order});
                    var pos_order_row = document.createElement('tbody');
                    pos_order_row.innerHTML = pos_order_row_html;
                    pos_order_row = pos_order_row.childNodes[1];
                    this.pos_order_cache.cache_node(order.id, pos_order_row);
                }
                if (order === this.order_selected) {
                    pos_order_row.classList.add('highlight');
                } else {
                    pos_order_row.classList.remove('highlight');
                }
                contents.appendChild(pos_order_row);
            }
        },
        hide_order_selected: function () { // hide when re-print receipt
            var contents = this.$('.pos_detail');
            contents.empty();
            this.order_selected = null;

        },
        display_pos_order_detail: function (order) {
            var contents = this.$('.pos_detail');
            contents.empty();
            var self = this;
            this.order_selected = order;
            if (!order) {
                return;
            }
            order['link'] = window.location.origin + "/web#id=" + order.id + "&view_type=form&model=pos.order";
            contents.append($(qweb.render('pos_order_detail', {widget: this, order: order})));
            var lines = this.pos.db.lines_by_order_id[order['id']];
            if (lines) {
                var line_contents = this.$('.lines_detail');
                line_contents.empty();
                line_contents.append($(qweb.render('pos_order_lines', {widget: this, lines: lines})));
            }
            ;
            this.$('.return_order').click(function () {
                var order = self.order_selected;
                var order_lines = self.pos.db.lines_by_order_id[order.id];
                if (!order_lines) {
                    return self.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Order empty lines',
                    });
                } else {
                    return self.gui.show_popup('popup_return_pos_order_lines', {
                        order_lines: order_lines,
                        order: order
                    });
                }
            });
            this.$('.register_amount').click(function () {
                var pos_order = self.order_selected;
                if (pos_order) {
                    self.gui.show_popup('popup_register_payment', {
                        pos_order: pos_order
                    })
                }
            });
            this.$('.create_invoice').click(function () {
                var pos_order = self.order_selected;
                if (pos_order) {
                    return self.gui.show_popup('alert_confirm', {
                        title: 'Are you want create invoice for : ' + pos_order['name'] + ' ?',
                        body: 'If you sure, click on Yes button',
                        confirmButtonText: 'Yes',
                        cancelButtonText: 'Close',
                        confirm: function () {
                            self.pos.gui.close_popup();
                            return rpc.query({
                                model: 'pos.order',
                                method: 'made_invoice',
                                args:
                                    [[pos_order['id']]],
                                context: {
                                    pos: true
                                }
                            }).then(function (invoice_vals) {
                                var message = "<a class='so_link' target='_blank' href='" + window.location.origin + "/web#id=" + invoice_vals[0]['id'] + "&view_type=form&model=account.invoice'" + ">";
                                message += invoice_vals[0]['number'];
                                message += "</a>";
                                return self.gui.show_popup('alert_confirm', {
                                    title: message,
                                    body: 'Click for open new tab review invoice just created.',
                                    confirmButtonText: 'Yes',
                                    cancelButtonText: 'Close',
                                    confirm: function () {
                                        self.pos.gui.close_popup();
                                    },
                                    cancel: function () {
                                        self.pos.gui.close_popup();
                                    }
                                });
                            }).fail(function (type, error) {
                                return self.pos.query_backend_fail(type, error);
                            });
                        },
                        cancel: function () {
                            return self.pos.gui.close_popup();
                        }
                    });
                }
            });
            this.$('.reprint_order').click(function () {
                var order = self.order_selected;
                if (!order) {
                    return;
                }
                var json = {
                    'date': self.pos.format_date(order['date_order']),
                    'sequence_number': order['sequence_number'],
                    'name': order.name,
                    'partner_id': order.partner_id.id || null,
                    'lines': [],
                    'amount_total': order.amount_total,
                    'uid': order['uid'],
                    'statement_ids': [],
                    'id': order.id,
                    'ean13': order.ean13
                };
                var lines = self.pos.db.lines_by_order_id[order.id];
                if (lines) {
                    for (var i in lines) {
                        var line = lines[i];
                        json['lines'].push([0, 0, {
                            'price_unit': line.price_unit,
                            'qty': line.qty,
                            'product_id': line.product_id[0],
                            'discount': line.discount,
                            'pack_lot_ids': [],
                            'id': line.id
                        }])
                    }
                } else {
                    var lines = self.pos.db.lines_by_order_id[order['id']];
                    for (var i = 0; i < lines.length; i++) {
                        lines[i][2].qty = -lines[i][2].qty
                    }
                    json.lines = order.lines;
                }
                if (order) {
                    var order_temporary = new models.Order({}, {pos: self.pos, json: json, temporary: true});
                    var orders = self.pos.get('orders');
                    orders.add(order_temporary);
                    self.pos.set('selectedOrder', order_temporary);
                    self.pos.gui.show_screen('receipt');
                    self.hide_order_selected();
                }
            });
            this.$('.action_pos_order_cancel').click(function () {
                var order = self.order_selected;
                self.pos.gui.show_popup('alert_confirm', {
                    title: 'Warning',
                    body: 'Are you sure cancel this order ' + order['name'],
                    confirmButtonText: 'Yes',
                    cancelButtonText: 'Close',
                    confirm: function () {
                        return rpc.query({
                            model: 'pos.order',
                            method: 'action_pos_order_cancel',
                            args:
                                [[self.order_selected['id']]],
                            context: {
                                pos: true
                            }
                        }).then(function () {
                            self.display_pos_order_detail(null);
                            self.pos.gui.show_popup('alert_result', {
                                title: 'Succeed',
                                body: 'Order just processed to cancel'
                            });
                            var orders = _.filter(self.pos.db.orders_store, function (order) {
                                return order['state'] != 'paid' && order['state'] != 'done' && order['state'] != 'invoiced' && order['state'] != 'cancel'
                            });
                            self.render_pos_order_list(orders);
                            return self.pos.gui.close_popup();
                        }).fail(function (type, error) {
                            return self.pos.query_backend_fail(type, error);
                        })
                    },
                    cancel: function () {
                        return self.pos.gui.close_popup();
                    }
                })
            })
        }
    });
    gui.define_screen({name: 'pos_orders_screen', widget: pos_orders_screen});

    var sale_orders = screens.ScreenWidget.extend({ // sale orders screen, booked orders
        template: 'sale_orders',

        init: function (parent, options) {
            var self = this;
            this._super(parent, options);
            this.sale_orders_cache = new screens.DomCache();
            this.sale_selected = null;
            this.pos.bind('sync:sale_orders', function (sale_id) {
                var current_screen = self.pos.gui.get_current_screen();
                if (current_screen == 'sale_orders' && self.sale_selected && self.sale_selected['id'] == sale_id) {
                    self.show();
                    var sale = self.pos.db.sale_order_by_id[sale_id];
                    self.display_sale_order(sale);
                }
            }, this);
        },

        show: function (options) {
            var sale_selected = this.pos.sale_selected;
            this._super(options);
            var self = this;
            this.$('.back').click(function () {
                self.gui.show_screen('products');
            });
            this.auto_complete_search();
            var search_timeout = null;
            this.render_sale_orders(this.pos.db.sale_orders);
            this.$('.client-list-contents').delegate('.sale_row', 'click', function (event) {
                self.order_select(event, $(this), parseInt($(this).data('id')));
            });
            var search_timeout = null;

            if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }

            this.$('.searchbox input').on('keypress', function (event) {
                clearTimeout(search_timeout);
                var searchbox = this;
                search_timeout = setTimeout(function () {
                    self.perform_search(searchbox.value, event.which === 13);
                }, 70);
                var contents = self.$('.sale_order_detail');
                contents.empty();
            });
            this.$('.booked_order_button').click(function () {
                var sale_orders = _.filter(self.pos.db.sale_orders, function (order) {
                    return order['book_order'] == true && (order['state'] == 'draft' || order['state'] == 'sent');
                });
                var contents = self.$('.sale_order_detail');
                contents.empty();
                self.render_sale_orders(sale_orders);

            });
            this.$('.sale_lock_button').click(function () {
                var sale_orders = _.filter(self.pos.db.sale_orders, function (order) {
                    return order['state'] == 'sale' || order['state'] == 'done';
                });
                var contents = self.$('.sale_order_detail');
                contents.empty();
                self.render_sale_orders(sale_orders);
            });
            this.$('.searchbox .search-clear').click(function () {
                var contents = self.$('.sale_order_detail');
                contents.empty();
                self.clear_search();
            });
            if (sale_selected) {
                var sale = self.pos.db.sale_order_by_id[sale_selected['id']];
                self.display_sale_order(sale);
            }
        },
        clear_search: function () {
            var contents = this.$('.sale_order_detail');
            contents.empty();
            this.render_sale_orders(this.pos.db.sale_orders);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
        perform_search: function (query, associate_result) {
            var orders;
            if (query) {
                orders = this.pos.db.search_sale_orders(query);
                if (associate_result && orders.length === 1) {
                    return this.display_sale_order(orders[0]);
                }
                return this.render_sale_orders(orders);
            } else {
                sale_orders = this.pos.db.sale_orders;
                return this.render_sale_orders(sale_orders);
            }
        },
        auto_complete_search: function () {
            var self = this;
            var $search_box = $('.search-pos-order >input');
            if ($search_box) {
                $search_box.autocomplete({
                    source: this.pos.db.sale_orders_autocomplete,
                    minLength: this.pos.minLength,
                    select: function (event, ui) {
                        if (ui && ui['item'] && ui['item']['value']) {
                            var order = self.pos.db.sale_order_by_id[ui['item']['value']];
                            self.display_sale_order(order);
                            setTimeout(function () {
                                self.clear_search();
                            }, 1000);
                        }
                    }
                });
            }
        },
        partner_icon_url: function (id) {
            return '/web/image?model=res.partner&id=' + id + '&field=image_small';
        },
        order_select: function (event, $order, id) {
            var order = this.pos.db.sale_order_by_id[id];
            this.$('.client-line').removeClass('highlight');
            this.$('.client-line').addClass('lowlight');
            $order.addClass('highlight');
            this.display_sale_order(order);
        },
        render_sale_orders: function (sales) {
            var contents = this.$el[0].querySelector('.sale_orders_table');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(sales.length, 1000); i < len; i++) {
                var sale = sales[i];
                var sale_row = this.sale_orders_cache.get_node(sale.id);
                if (!sale_row) {
                    var sale_row_html = qweb.render('sale_row', {widget: this, sale: sale});
                    var sale_row = document.createElement('tbody');
                    sale_row.innerHTML = sale_row_html;
                    sale_row = sale_row.childNodes[1];
                    this.sale_orders_cache.cache_node(sale.id, sale_row);
                }
                if (sale === this.sale_selected) {
                    sale_row.classList.add('highlight');
                } else {
                    sale_row.classList.remove('highlight');
                }
                contents.appendChild(sale_row);
            }
        },
        display_sale_order: function (sale) {
            this.sale_selected = sale;
            var self = this;
            var contents = this.$('.sale_order_detail');
            contents.empty();
            if (!sale) {
                return;
            }
            sale['link'] = window.location.origin + "/web#id=" + sale.id + "&view_type=form&model=sale.order";
            contents.append($(qweb.render('sale_order_detail', {widget: this, sale: sale})));
            var sale_lines = this.pos.db.sale_lines_by_sale_id[sale.id];
            if (sale_lines) {
                var line_contents = this.$('.lines_detail');
                line_contents.empty();
                line_contents.append($(qweb.render('sale_order_lines', {widget: this, lines: sale_lines})));
            }
            this.$('.print_quotation').click(function () {
                self.chrome.do_action('sale.action_report_saleorder', {
                    additional_context: {
                        active_ids: [self.sale_selected['id']]
                    }
                })
            });
            this.$('.action_report_pro_forma_invoice').click(function () {
                self.chrome.do_action('sale.action_report_saleorder', {
                    additional_context: {
                        active_ids: [self.sale_selected['id']]
                    }
                })
            });
            this.$('.action_confirm').click(function () {
                self.pos.gui.close_popup();
                return rpc.query({
                    model: 'sale.order',
                    method: 'action_confirm',
                    args:
                        [[self.sale_selected['id']]],
                    context: {
                        pos: true
                    }
                }).then(function (result) {
                    var body = "<a class='so_link' target='_blank' href=" + window.location.origin + "/web#id=" + self.sale_selected.id + "&view_type=form&model=sale.order +>" + self.sale_selected['name'] + ' (Click review)' + "</a>";
                    return self.gui.show_popup('alert_confirm', {
                        title: 'Sale order just confirmed',
                        body: body,
                        confirmButtonText: 'Yes',
                        cancelButtonText: 'Close',
                        confirm: function () {
                            self.pos.gui.close_popup();
                        },
                        cancel: function () {
                            self.pos.gui.close_popup();
                        }
                    })
                }).fail(function (type, error) {
                    return self.pos.query_backend_fail(type, error);
                })
            });
            this.$('.action_done').click(function () {
                return rpc.query({
                    model: 'sale.order',
                    method: 'action_done',
                    args:
                        [[self.sale_selected['id']]],
                    context: {
                        pos: true
                    }
                }).then(function () {
                    var body = "<a class='so_link' target='_blank' href=" + window.location.origin + "/web#id=" + self.sale_selected.id + "&view_type=form&model=sale.order +>" + self.sale_selected['name'] + ' (Click review)' + "</a>";
                    return self.gui.show_popup('alert_confirm', {
                        title: 'Sale order processed to done',
                        body: body,
                        confirmButtonText: 'Yes',
                        cancelButtonText: 'Close',
                        confirm: function () {
                            self.pos.gui.close_popup();
                        },
                        cancel: function () {
                            self.pos.gui.close_popup();
                        }
                    })
                }).fail(function (type, error) {
                    return self.pos.query_backend_fail(type, error);
                })
            });
            this.$('.action_return').click(function () {
                if (self.sale_selected) {
                    self.pos.gui.show_popup('popup_stock_return_picking', {
                        sale: self.sale_selected,
                        title: 'Return sale order',
                        confirm: function () {
                            self.render_sale_orders(self.pos.db.sale_orders);
                        }
                    })
                }

            })
            this.$('.action_validate_picking').click(function () {
                if (self.sale_selected) {
                    return rpc.query({
                        model: 'sale.order',
                        method: 'action_validate_picking',
                        args:
                            [[self.sale_selected['id']]],
                        context: {
                            pos: true
                        }
                    }).then(function (picking_name) {
                        if (picking_name) {
                            var body = "<a class='so_link' target='_blank' href=" + window.location.origin + "/web#id=" + self.sale_selected.id + "&view_type=form&model=sale.order +>" + self.sale_selected['name'] + ' (Click review)' + "</a>";
                            return self.gui.show_popup('alert_confirm', {
                                title: 'Sale order validated delivery order',
                                body: body,
                                confirmButtonText: 'Yes',
                                cancelButtonText: 'Close',
                                confirm: function () {
                                    self.pos.gui.close_popup();
                                },
                                cancel: function () {
                                    self.pos.gui.close_popup();
                                }
                            })
                        } else {
                            var body = "<a class='so_link' target='_blank' href=" + window.location.origin + "/web#id=" + self.sale_selected.id + "&view_type=form&model=sale.order +>" + self.sale_selected['name'] + ' (Click review)' + "</a>";
                            return self.gui.show_popup('alert_confirm', {
                                title: 'Order dilivery done or have issue, please review',
                                body: body,
                                confirmButtonText: 'Yes',
                                cancelButtonText: 'Close',
                                confirm: function () {
                                    self.pos.gui.close_popup();
                                },
                                cancel: function () {
                                    self.pos.gui.close_popup();
                                }
                            })
                        }
                        return self.pos.gui.close_popup();
                    }).fail(function (type, error) {
                        return self.pos.query_backend_fail(type, error);
                    })
                }
            })
            this.$('.delivery_order').click(function () {
                if (self.sale_selected) {
                    var lines = self.pos.db.sale_lines_by_sale_id[self.sale_selected['id']];
                    var sale_selected = self.sale_selected;
                    if (!lines) {
                        return self.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Sale order is blank lines, could not cover to pos order',
                            timer: 4000,
                        })
                    }
                    var order = new models.Order({}, {pos: self.pos, temporary: true});
                    order['name'] = self.sale_selected['name'];
                    order['sale_id'] = sale_selected['id'];
                    order['delivery_address'] = sale_selected['delivery_address'];
                    order['delivery_date'] = sale_selected['delivery_date'];
                    order['delivery_phone'] = sale_selected['delivery_phone'];
                    var partner_id = sale_selected['partner_id'];
                    var partner = self.pos.db.get_partner_by_id(partner_id[0]);
                    if (partner) {
                        order.set_client(partner);
                    } else {
                        return self.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Partner ' + partner_id[1] + ' not available on pos, please update this partner active on POS',
                            timer: 4000,
                        })
                    }
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i];
                        var product = self.pos.db.get_product_by_id(line.product_id[0])
                        if (!product) {
                            return self.pos.gui.show_popup('alert_result', {
                                title: 'Warning',
                                body: 'Product ' + line.product_id[1] + ' not available on pos, please checking to field available on pos for this product',
                                timer: 4000,
                            })
                        } else {
                            var new_line = new models.Orderline({}, {pos: self.pos, order: order, product: product});
                            new_line.set_unit_price(line.price_unit)
                            new_line.set_quantity(line.product_uom_qty, 'keep price');
                            order.orderlines.add(new_line);
                        }
                    }
                    if (self.sale_selected['payment_partial_amount'] && self.sale_selected['payment_partial_journal_id']) {
                        var payment_partial_journal_id = self.sale_selected['payment_partial_journal_id'][0];
                        var payment_partial_register = _.find(self.pos.cashregisters, function (cashregister) {
                            return cashregister.journal['id'] == payment_partial_journal_id;
                        });
                        if (payment_partial_register) {
                            var partial_paymentline = new models.Paymentline({}, {
                                order: order,
                                cashregister: payment_partial_register,
                                pos: self.pos
                            });
                            partial_paymentline.set_amount(self.sale_selected['payment_partial_amount']);
                            order.paymentlines.add(partial_paymentline);
                            order['amount_debit'] = order.get_total_with_tax() - self.sale_selected['payment_partial_amount']
                        } else {
                            return self.pos.gui.show_popup('alert_result', {
                                title: 'Warning',
                                body: 'POS have not journal ' + self.sale_selected['payment_partial_journal_id'][1],
                                timer: 4000,
                            })
                        }
                    }
                    var orders = self.pos.get('orders');
                    orders.add(order);
                    self.pos.set('selectedOrder', order);
                    self.pos.gui.show_screen('receipt');
                }
            })
        }
    });
    gui.define_screen({name: 'sale_orders', widget: sale_orders});

    var products_screen = screens.ScreenWidget.extend({ // products screen
        template: 'products_screen',
        start: function () {
            var self = this;
            this._super();
            this.products = this.pos.products;
            this.product_by_id = {};
            this.product_by_string = "";
            if (this.products) {
                this.save_products(this.products);
            }
        },
        init: function (parent, options) {
            var self = this;
            this._super(parent, options);
            this.product_cache = new screens.DomCache();
            this.pos.bind('sync:product', function (product_data) { // product operation update screen
                var products = _.filter(self.products, function (product) {
                    return product['id'] != product_data['id'];
                });
                products.push(product_data);
                self.product_by_string = "";
                self.save_products(products);
            })
        },
        save_products: function (products) {
            for (var i = 0; i < products.length; i++) {
                var product = products[i];
                this.product_by_id[product['id']] = product;
                this.product_by_string += this.pos.db._product_search_string(product);
            }
        },
        search_products: function (query) {
            try {
                query = query.replace(/[\[\]\(\)\+\*\?\.\-\!\&\^\$\|\~\_\{\}\:\,\\\/]/g, '.');
                query = query.replace(' ', '.+');
                var re = RegExp("([0-9]+):.*?" + query, "gi");
            } catch (e) {
                return [];
            }
            var results = [];
            for (var i = 0; i < 1000; i++) {
                var r = re.exec(this.product_by_string);
                if (r && r[1]) {
                    var id = r[1];
                    if (this.product_by_id[id] !== undefined) {
                        results.push(this.product_by_id[id]);
                    } else {
                        var code = r
                    }
                } else {
                    break;
                }
            }
            return results;
        },
        show: function () {
            var self = this;
            this._super();
            this.renderElement();
            this.details_visible = false;
            this.old_product = null;
            this.$('.back').click(function () {
                self.gui.back();
            });
            this.$('.new-product').click(function () {
                self.display_product_edit('show', {});
            });
            this.render_list(this.products);
            if (this.old_product) {
                this.display_product_edit('show', this.old_product, 0);
            }
            this.$('.client-list-contents').delegate('.product_row', 'click', function (event) {
                self.product_selected(event, $(this), parseInt($(this).data('id')));
            });
            var search_timeout = null;
            if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }
            this.$('.searchbox input').on('keypress', function (event) {
                clearTimeout(search_timeout);
                var query = this.value;
                search_timeout = setTimeout(function () {
                    self.perform_search(query, event.which === 13);
                }, 70);
            });
            this.$('.searchbox .search-product').click(function () {
                self.clear_search();
            });
        },
        hide: function () {
            this._super();
        },
        perform_search: function (query, associate_result) {
            var products = this.search_products(query);
            this.render_list(products);
        },
        clear_search: function () {
            this.render_list(this.products);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },
        render_list: function (products) {
            var self = this;
            var contents = this.$el[0].querySelector('.client-list-contents');
            contents.innerHTML = "";
            for (var i = 0, len = Math.min(products.length, 1000); i < len; i++) {
                var product = products[i];
                var product_line_html = qweb.render('product_row', {widget: this, product: products[i]});
                var product_line = document.createElement('tbody');
                product_line.innerHTML = product_line_html;
                product_line = product_line.childNodes[1];
                this.product_cache.cache_node(product.id, product_line);
                if (product === this.old_product) {
                    product_line.classList.add('highlight');
                } else {
                    product_line.classList.remove('highlight');
                }
                contents.appendChild(product_line);
            }
            var products = [];
            for (var i = 0; i < this.products.length; i++) {
                var product = this.products[i];
                var label = "";
                if (product['default_code']) {
                    label = '[' + product['default_code'] + ']'
                }
                if (product['barcode']) {
                    label = '[' + product['barcode'] + ']'
                }
                if (product['display_name']) {
                    label = '[' + product['display_name'] + ']'
                }
                if (product['description']) {
                    label = '[' + product['description'] + ']'
                }
                products.push({
                    value: product['id'],
                    label: label
                })
            }
            var $search_box = $('.clientlist-screen .searchbox >input');
            $search_box.autocomplete({
                source: this.pos.db.products_autocomplete,
                minLength: this.pos.minLength,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var product = self.product_by_id(ui['item']['value']);
                        if (product) {
                            self.display_product_edit('show', product);
                        }
                        setTimeout(function () {
                            self.clear_search();
                        }, 100);
                    }
                }
            });
        },
        product_selected: function (event, $line, id) {
            var product = this.product_by_id[id];
            this.$('.client-list .lowlight').removeClass('lowlight');
            if ($line.hasClass('highlight')) {
                $line.removeClass('highlight');
                $line.addClass('lowlight');
                this.display_product_edit('hide', product);
            } else {
                this.$('.client-list .highlight').removeClass('highlight');
                $line.addClass('highlight');
                var y = event.pageY - $line.parent().offset().top;
                this.display_product_edit('show', product, y);
            }
        },

        // return url image for widget xml
        product_icon_url: function (id) {
            return '/web/image?model=product.product&id=' + id + '&field=image_small';
        },
        // save product values to backend
        // trigger refesh products screen
        save_product_edit: function (product) {
            var self = this;
            var fields = {};
            this.$('.client-details-contents .detail').each(function (idx, el) {
                fields[el.name] = el.value || false;
            });
            if (!fields.name) {
                return this.pos.gui.show_popup('alert_result', {
                    title: 'Error',
                    body: 'A Product name is required'
                });
            }
            if (this.uploaded_picture) {
                fields.image = this.uploaded_picture.split(',')[1];
            }
            fields['list_price'] = parseFloat(fields['list_price']);
            fields['pos_categ_id'] = parseFloat(fields['pos_categ_id']);
            if (fields['id']) {
                rpc.query({
                    model: 'product.product',
                    method: 'write',
                    args: [[parseInt(fields['id'])], fields],
                })
                    .then(function (result) {
                        if (result == true) {
                            self.pos.gui.show_popup('alert_result', {
                                title: 'Saved',
                                body: 'Product saved'
                            })
                        }
                    }, function (type, err) {
                        self.pos.gui.show_popup('alert_result', {
                            title: 'Error',
                            body: 'Odoo connection fail, could not save'
                        })
                    });
            } else {
                rpc.query({
                    model: 'product.product',
                    method: 'create',
                    args: [fields],
                })
                    .then(function (product_id) {
                        self.$('.client-details-contents').hide();
                        self.pos.gui.show_popup('alert_result', {
                            title: 'Saved',
                            body: 'Product saved'
                        })
                    }, function (type, err) {
                        self.pos.gui.show_popup('alert_result', {
                            title: 'Error',
                            body: 'Odoo connection fail, could not save'
                        })
                    });
            }
        },
        // resizes an image, keeping the aspect ratio intact,
        // the resize is useful to avoid sending 12Mpixels jpegs
        // over a wireless connection.
        resize_image_to_dataurl: function (img, maxwidth, maxheight, callback) {
            img.onload = function () {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                var ratio = 1;

                if (img.width > maxwidth) {
                    ratio = maxwidth / img.width;
                }
                if (img.height * ratio > maxheight) {
                    ratio = maxheight / img.height;
                }
                var width = Math.floor(img.width * ratio);
                var height = Math.floor(img.height * ratio);

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                var dataurl = canvas.toDataURL();
                callback(dataurl);
            };
        },
        // Loads and resizes a File that contains an image.
        // callback gets a dataurl in case of success.
        load_image_file: function (file, callback) {
            var self = this;
            if (!file) {
                return;
            }
            if (file.type && !file.type.match(/image.*/)) {
                return this.pos.gui.show_popup('alert_result', {
                    title: 'Error',
                    body: 'Unsupported File Format, Only web-compatible Image formats such as .png or .jpeg are supported',
                });
            }

            var reader = new FileReader();
            reader.onload = function (event) {
                var dataurl = event.target.result;
                var img = new Image();
                img.src = dataurl;
                self.resize_image_to_dataurl(img, 600, 400, callback);
            };
            reader.onerror = function () {
                return self.pos.gui.show_popup('alert_result', {
                    title: 'Error',
                    body: 'Could Not Read Image, The provided file could not be read due to an unknown error',
                });
            };
            reader.readAsDataURL(file);
        },
        display_product_edit: function (visibility, product, clickpos) { // display product details to header page
            var self = this;
            var contents = this.$('.client-details-contents');
            contents.empty();
            if (visibility == 'show') {
                contents.append($(qweb.render('product_edit', {widget: this, product: product})));
                contents.find('.save').on('click', function (event) {
                    self.save_product_edit(event);
                });
                contents.find('.print_label').on('click', function (event) {
                    var fields = {};
                    $('.client-details-contents .detail').each(function (idx, el) {
                        fields[el.name] = el.value || false;
                    });
                    var product_id = fields['id'];
                    var product = self.pos.db.product_by_id[product_id];
                    if (product && product['barcode']) {
                        var product_label_html = qweb.render('product_label_xml', {
                            product: product
                        });
                        self.pos.proxy.print_receipt(product_label_html);
                        self.pos.gui.show_popup('alert_result', {
                            title: 'Printed barcode',
                            body: 'Please get product label at your printer'
                        })
                    } else {
                        self.pos.gui.show_popup('alert_result', {
                            title: 'Missing barcode',
                            body: 'Barcode of product not set'
                        })
                    }

                })
                this.$('.client-details-contents').show();
            }
            if (visibility == 'hide') {
                this.$('.client-details-contents').hide();
            }

            contents.find('input').blur(function () {
                setTimeout(function () {
                    self.$('.window').scrollTop(0);
                }, 0);
            });
            contents.find('.image-uploader').on('change', function (event) {
                self.load_image_file(event.target.files[0], function (res) {
                    if (res) {
                        contents.find('.client-picture img, .client-picture .fa').remove();
                        contents.find('.client-picture').append("<img src='" + res + "'>");
                        contents.find('.detail.picture').remove();
                        self.uploaded_picture = res;
                    }
                });
            });
        },
        // close screen
        close: function () {
            this._super();
        }
    });
    gui.define_screen({name: 'productlist', widget: products_screen});

    screens.ReceiptScreenWidget.include({
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back_order').click(function () {
                var order = self.pos.get_order();
                if (order) {
                    self.pos.gui.show_screen('products');
                }
            });
        },
        show: function () {
            this._super();
            try {
                JsBarcode("#barcode", this.pos.get('selectedOrder').ean13, {
                    format: "EAN13",
                    displayValue: true,
                    fontSize: 20
                });
            } catch (error) {
            }
        },
        render_receipt: function () {
            this._super();
            if (this.pos.config.duplicate_receipt && this.pos.config.print_number > 1) {
                var contents = $('.pos-receipt-container');
                var i = 1;
                while (i < this.pos.config.print_number) {
                    contents.append(qweb.render('PosTicket', this.get_receipt_render_env()));
                    i++;
                }
            }
        },
        print_xml: function () {
            if (this.pos.config.duplicate_receipt && this.pos.config.print_number > 1) {
                var i = 1;
                while (i <= this.pos.config.print_number) {
                    var receipt = qweb.render('XmlReceipt', this.get_receipt_render_env());
                    this.pos.proxy.print_receipt(receipt);
                    i++;
                }
                this.pos.get_order()._printed = true;
            } else {
                return this._super();
            }
        },
        get_receipt_render_env: function () {
            var data_print = this._super();
            var orderlines_by_category_name = {};
            var order = this.pos.get_order();
            var orderlines = order.orderlines.models;
            var categories = [];
            if (this.pos.config.category_wise_receipt) {
                for (var i = 0; i < orderlines.length; i++) {
                    var line = orderlines[i];
                    var pos_categ_id = line['product']['pos_categ_id']
                    if (pos_categ_id && pos_categ_id.length == 2) {
                        var root_category_id = order.get_root_category_by_category_id(pos_categ_id[0])
                        var category = this.pos.db.category_by_id[root_category_id]
                        var category_name = category['name'];
                        if (!orderlines_by_category_name[category_name]) {
                            orderlines_by_category_name[category_name] = [line];
                            var category_index = _.findIndex(categories, function (category) {
                                return category == category_name;
                            });
                            if (category_index == -1) {
                                categories.push(category_name)
                            }
                        } else {
                            orderlines_by_category_name[category_name].push(line)
                        }

                    } else {
                        if (!orderlines_by_category_name['None']) {
                            orderlines_by_category_name['None'] = [line]
                        } else {
                            orderlines_by_category_name['None'].push(line)
                        }
                        var category_index = _.findIndex(categories, function (category) {
                            return category == 'None';
                        });
                        if (category_index == -1) {
                            categories.push('None')
                        }
                    }
                }
            }
            data_print['orderlines_by_category_name'] = orderlines_by_category_name;
            data_print['categories'] = categories;
            return data_print
        }
    });

    screens.PaymentScreenWidget.include({
        order_changes: function () {
            this._super();
            this.renderElement();
            var order = this.pos.get_order();
            if (!order) {
                return;
            } else if (order.is_paid()) {
                self.$('.next').addClass('highlight');
            } else {
                self.$('.next').removeClass('highlight');
            }
        },
        click_invoice: function () {
            this._super();
            var order = this.pos.get_order();
            if (order.is_to_invoice()) {
                this.$('.js_invoice').addClass('btn-success');
            } else {
                this.$('.js_invoice').removeClass('btn-success');
            }
        },
        customer_changed: function () { // when client change, email invoice auto change
            this._super();
            var client = this.pos.get_client();
            var $send_invoice_email = this.$('.send_invoice_email');
            if (client && client.email) {
                if ($send_invoice_email && $send_invoice_email.length) {
                    $send_invoice_email.text(client ? client.email : _t('N/A'));
                }
            } else {
                if ($send_invoice_email && $send_invoice_email.length) {
                    $send_invoice_email.text('Email N/A');
                }
            }
        },
        click_invoice_journal: function (journal_id) { // change invoice journal when create invoice
            var order = this.pos.get_order();
            order['invoice_journal_id'] = journal_id;
            this.$('.journal').removeClass('btn-success');
            var $journal_selected = this.$("[journal-id='" + journal_id + "']");
            $journal_selected.addClass('btn-success');
        },
        render_invoice_journals: function () { // render invoice journal, no use invoice journal default of pos
            var self = this;
            var methods = $(qweb.render('journal_list', {widget: this}));
            methods.on('click', '.journal', function () {
                self.click_invoice_journal($(this).data('id'));
            });
            return methods;
        },

        renderElement: function () {
            var self = this;
            // Quickly Payment
            if (this.pos.quickly_datas) {
                this.quickly_datas = this.pos.quickly_datas;
            } else {
                this.quickly_datas = []
            }
            this._super();
            if (this.pos.config.invoice_journal_ids && this.pos.config.invoice_journal_ids.length > 0 && this.pos.journals) {
                var methods = this.render_invoice_journals();
                methods.appendTo(this.$('.invoice_journals'));
            }
            var order = this.pos.get_order();
            if (order && this.pos.currency && this.pos.currency_by_id) {// Multi Currency
                order.selected_currency = this.pos.currency_by_id[this.pos.currency.id];
            }
            this.$('.select-currency').on('change', function (e) {
                var currency_id = parseInt($('.select-currency').val());
                var selected_currency = self.pos.currency_by_id[currency_id];
                var company_currency = self.pos.currency_by_id[self.pos.currency['id']];
                // Return action if have not selected currency or company currency is 0
                if (!selected_currency || company_currency['rate'] == 0) {
                    return;
                }
                order.selected_currency = selected_currency;
                var currency_covert_text = company_currency['rate'] / selected_currency['rate'];
                // add current currency rate to payment screen
                var $currency_covert = self.el.querySelector('.currency-covert');
                if ($currency_covert) {
                    $currency_covert.textContent = '1 ' + selected_currency['name'] + ' = ' + currency_covert_text + ' ' + company_currency['name'];
                }
                var selected_paymentline = order.selected_paymentline;
                var default_register = _.find(self.pos.cashregisters, function (register) {
                    return register['journal']['pos_method_type'] == 'default';
                });
                if (selected_paymentline) {
                    selected_paymentline.set_amount("0");
                    self.inputbuffer = "";
                }
                if (!selected_paymentline && default_register) {
                    order.add_paymentline(default_register);
                }
                var due = order.get_due();
                var amount_full_paid = due * selected_currency['rate'] / company_currency['rate'];
                var due_currency = amount_full_paid;
                var $currency_paid_full = self.el.querySelector('.currency-paid-full');
                if ($currency_paid_full) {
                    $currency_paid_full.textContent = due_currency;
                }
                self.add_currency_to_payment_line();
                self.render_paymentlines();
            });
            this.$('.update-rate').on('click', function (e) {
                var currency_id = parseInt($('.select-currency').val());
                var selected_currency = self.pos.currency_by_id[currency_id];
                self.selected_currency = selected_currency;
                if (selected_currency) {
                    self.hide();
                    self.gui.show_popup('textarea', {
                        title: _t('Input Rate'),
                        value: self.selected_currency['rate'],
                        confirm: function (rate) {
                            var selected_currency = self.selected_currency;
                            selected_currency['rate'] = parseFloat(rate);
                            self.show();
                            self.renderElement();
                            var params = {
                                name: new Date(),
                                currency_id: self.selected_currency['id'],
                                rate: parseFloat(rate),
                            };
                            return rpc.query({
                                model: 'res.currency.rate',
                                method: 'create',
                                args:
                                    [params],
                                context: {}
                            }).then(function (rate_id) {
                                return self.pos.gui.show_popup('alert_result', {
                                    title: 'Success',
                                    body: 'Update rate done'
                                })
                            }).then(function () {
                                return self.gui.close_popup();
                            }).fail(function (type, error) {
                                self.pos.query_backend_fail(type, error);
                            });
                        },
                        cancel: function () {
                            self.show();
                            self.renderElement();
                        }
                    });
                }
            });
            this.$('.add_note').click(function () { // Button add Note
                var order = self.pos.get_order();
                if (order) {
                    self.hide();
                    self.gui.show_popup('textarea', {
                        title: _t('Add Order Note'),
                        value: order.get_note(),
                        confirm: function (note) {
                            order.set_note(note);
                            order.trigger('change', order);
                            self.show();
                            self.renderElement();
                        },
                        cancel: function () {
                            self.show();
                            self.renderElement();
                        }
                    });
                }
            });
            this.$('.signature_order').click(function () { // Signature on Order
                var order = self.pos.get_order();
                self.hide();
                self.gui.show_popup('popup_order_signature', {
                    order: order,
                    confirm: function (rate) {
                        self.show();
                    },
                    cancel: function () {
                        self.show();
                    }
                });

            });
            this.$('.paid_full').click(function () { // payment full
                var order = self.pos.get_order();
                var selected_paymentline = order.selected_paymentline;
                var register = _.find(self.pos.cashregisters, function (register) {
                    return register['journal']['pos_method_type'] == 'default';
                });
                var amount_due = order.get_due();
                if (register) {
                    if (!selected_paymentline) {
                        order.add_paymentline(register);
                        selected_paymentline = order.selected_paymentline;
                    }
                    selected_paymentline.set_amount(amount_due);
                    self.order_changes();
                    self.render_paymentlines();
                    self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(amount_due));
                }
            });
            this.$('.paid_partial').click(function () { // partial payment
                var order = self.pos.get_order();
                order.partial_payment = true;
                self.pos.push_order(order);
                self.gui.show_screen('receipt');
            });
            this.$('.add_credit').click(function () { // set change amount to credit
                self.click_add_credit();
            });
            this.$('.add_team').click(function () { // set change amount to credit
                self.hide();
                var list = [];
                for (var i = 0; i < self.pos.bus_locations.length; i++) {
                    var bus = self.pos.bus_locations[i];
                    list.push({
                        'label': bus['user_id'][1] + '/' + bus['name'],
                        'item': bus
                    })
                }
                return self.gui.show_popup('selection', {
                    title: _t('Select sale lead'),
                    list: list,
                    confirm: function (bus) {
                        var user_id = bus['user_id'][0];
                        var user = self.pos.user_by_id[user_id];
                        var order = self.pos.get_order();
                        if (user && order) {
                            self.pos.db.set_cashier(user);
                            self.pos.bus_location = bus;
                            order.trigger('change');
                        }
                        self.show();
                        self.renderElement();
                    },
                    cancel: function () {
                        self.show();
                        self.renderElement();
                    }
                });
            });
            this.$('.input_voucher').click(function () { // input manual voucher
                self.hide();
                return self.pos.gui.show_popup('alert_input', {
                    title: _t('Input code'),
                    html: '<div class="form-group">' +
                    '<input id="input-field" type="text" class="form-control voucher" />' +
                    '</div>',
                    body: 'Made sure odoo server running and input correct code of voucher',
                    confirmButtonText: 'Yes',
                    cancelButtonText: 'No',
                    confirm: function () {
                        var code = $('.voucher').val();
                        self.show();
                        self.renderElement();
                        if (!code) {
                            return false;
                        } else {
                            return rpc.query({
                                model: 'pos.voucher',
                                method: 'get_voucher_by_code',
                                args: [code],
                            }).then(function (voucher) {
                                if (voucher == -1) {
                                    return self.gui.show_popup('alert_confirm', {
                                        title: 'Wrong',
                                        body: 'Code have not exist or expired date',
                                        confirmButtonText: 'Yes',
                                        cancelButtonText: 'Close',
                                        confirm: function () {
                                            self.pos.gui.close_popup();
                                        },
                                        cancel: function () {
                                            self.pos.gui.close_popup();
                                        }
                                    });
                                } else {
                                    var current_order = self.pos.get('selectedOrder');
                                    current_order.voucher_id = voucher.id;
                                    var voucher_register = _.find(self.pos.cashregisters, function (cashregister) {
                                        return cashregister.journal['pos_method_type'] == 'voucher';
                                    });
                                    if (voucher_register) {
                                        if (voucher['customer_id'] && voucher['customer_id'][0]) {
                                            var client = self.pos.db.get_partner_by_id(voucher['customer_id'][0]);
                                            if (client) {
                                                current_order.set_client(client)
                                            }
                                        }
                                        var amount = 0;
                                        if (voucher['apply_type'] == 'fixed_amount') {
                                            amount = voucher.value;
                                        } else {
                                            amount = current_order.get_total_with_tax() / 100 * voucher.value;
                                        }
                                        // remove old paymentline have journal is voucher
                                        var paymentlines = current_order.paymentlines;
                                        for (var i = 0; i < paymentlines.models.length; i++) {
                                            var payment_line = paymentlines.models[i];
                                            if (payment_line.cashregister.journal['pos_method_type'] == 'voucher') {
                                                payment_line.destroy();
                                            }
                                        }
                                        // add new payment with this voucher just scanned
                                        var voucher_paymentline = new models.Paymentline({}, {
                                            order: current_order,
                                            cashregister: voucher_register,
                                            pos: self.pos
                                        });
                                        voucher_paymentline.set_amount(amount);
                                        current_order.paymentlines.add(voucher_paymentline);
                                        current_order.trigger('change', current_order)
                                        self.render_paymentlines();
                                        self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(amount));
                                        return true;
                                    } else {
                                        return self.gui.show_popup('alert_confirm', {
                                            title: 'Warning',
                                            body: 'Could not add payment line because your system have not create journal have type voucher or journal voucher not add to your pos config',
                                            confirmButtonText: 'Yes',
                                            cancelButtonText: 'Close',
                                            confirm: function () {
                                                self.pos.gui.close_popup();
                                            },
                                            cancel: function () {
                                                self.pos.gui.close_popup();
                                            }
                                        });
                                    }

                                }
                            }).fail(function (type, error) {
                                return self.pos.query_backend_fail(type, error);
                            });
                        }
                    },
                    cancel: function () {
                        self.show();
                        self.renderElement();
                    }
                });
            });
            this.$('.add_wallet').click(function () { // add change amount to wallet card
                self.hide();
                var order = self.pos.get_order();
                var change = order.get_change();
                var wallet_register = _.find(self.pos.cashregisters, function (cashregister) {
                    return cashregister.journal['pos_method_type'] == 'wallet';
                });
                if (!change || change == 0) {
                    return self.pos.gui.show_popup('alert_input', {
                        title: _t('Order change empty'),
                        html: '',
                        confirmButtonText: 'Ok, keep',
                        cancelButtonText: 'No, validate order',
                        cancel: function () {
                            self.show();
                            self.renderElement();
                            self.order_changes();
                            return self.pos.gui.close_popup();
                        },
                        confirm: function () {
                            self.show();
                            self.renderElement();
                            self.order_changes();
                            return self.pos.gui.close_popup();
                        }
                    });
                }
                // old version need add client but now no need add client
                // if (!order.get_client()) {
                //     return setTimeout(function () {
                //         self.pos.gui.show_screen('clientlist');
                //     }, 1);
                // }
                if (!wallet_register) {
                    return self.pos.gui.show_popup('alert_input', {
                        title: _t('Null'),
                        html: 'Wallet journal',
                        confirmButtonText: 'Ok, keep',
                        cancelButtonText: 'No, validate order',
                        cancel: function () {
                            self.show();
                            self.renderElement();
                            return self.pos.gui.close_popup();
                        },
                        confirm: function () {
                            self.show();
                            self.renderElement();
                            return self.pos.gui.close_popup();
                        }
                    });
                }
                if (order.finalized == false) {
                    self.gui.show_popup('number', {
                        'title': _t('Add to customer wallet'),
                        'value': change,
                        'confirm': function (value) {
                            if (value <= order.get_change()) {
                                var wallet_paymentline = new models.Paymentline({}, {
                                    order: order,
                                    cashregister: wallet_register,
                                    pos: self.pos
                                });
                                wallet_paymentline.set_amount(-value);
                                order.paymentlines.add(wallet_paymentline);
                                order.trigger('change', order);
                            }
                            self.show();
                            self.renderElement();
                            self.order_changes();
                        },
                        cancel: function () {
                            self.show();
                            self.renderElement();
                        }
                    });
                }
            });
            this.$('.quickly-payment').click(function () { // Quickly Payment
                self.pos.cashregisters = self.pos.cashregisters.sort(function (a, b) {
                    return a.id - b.id;
                });
                var quickly_payment_id = parseInt($(this).data('id'));
                var quickly_payment = self.pos.quickly_payment_by_id[quickly_payment_id];
                var order = self.pos.get_order();
                var paymentlines = order.get_paymentlines();
                var open_paymentline = false;
                for (var i = 0; i < paymentlines.length; i++) {
                    if (!paymentlines[i].paid) {
                        open_paymentline = true;
                    }
                }
                if (self.pos.cashregisters.length == 0) {
                    return;
                }
                if (!open_paymentline) {
                    var register_random = _.find(self.pos.cashregisters, function (register) {
                        return register['journal']['pos_method_type'] == 'default';
                    });
                    if (register_random) {
                        order.add_paymentline(register_random);
                    } else {
                        return;
                    }
                }
                if (quickly_payment && order.selected_paymentline) {
                    var money = quickly_payment['amount'] + order.selected_paymentline['amount']
                    order.selected_paymentline.set_amount(money);
                    self.order_changes();
                    self.render_paymentlines();
                    self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(money));
                }
            });
            this.$('.send_invoice_email').click(function () { // input email send invoice
                var order = self.pos.get_order();
                var client = order.get_client();
                if (client) {
                    if (client.email) {
                        var email_invoice = order.is_email_invoice();
                        order.set_email_invoice(!email_invoice);
                        if (order.is_email_invoice()) {
                            self.$('.send_invoice_email').addClass('btn-success');
                            if (!order.to_invoice) {
                                self.$('.js_invoice').click();
                            }
                        } else {
                            self.$('.send_invoice_email').removeClass('btn-success');
                            if (order.to_invoice) {
                                self.$('.js_invoice').click();
                            }
                        }
                    } else {
                        self.pos.gui.show_screen('clientlist');
                        return self.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Customer email is blank, please update'
                        })
                    }

                } else {
                    self.pos.gui.show_screen('clientlist');
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Please select client the first'
                    })
                }
            });
            this.$('.js_auto_register_payment').click(function () { // input email send invoice
                var order = self.pos.get_order();
                var client = order.get_client();
                if (client) {
                    var auto_register_payment = order.is_auto_register_payment();
                    order.set_auto_register_payment(!auto_register_payment);
                    if (order.is_auto_register_payment()) {
                        self.$('.js_auto_register_payment').addClass('btn-success');
                        if (!order.to_invoice) {
                            self.$('.js_invoice').click();
                        }
                    } else {
                        self.$('.js_auto_register_payment').removeClass('btn-success');
                        if (order.to_invoice) {
                            self.$('.js_invoice').click();
                        }
                    }
                } else {
                    self.pos.gui.show_screen('clientlist');
                    return self.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Please select client the first'
                    })
                }
            });
        },
        click_add_credit: function () {
            var order = this.pos.get_order();
            order.set_to_add_credit(!order.is_add_credit());
            if (order.is_add_credit()) {
                this.$('.add_credit').addClass('btn btn-success');
            } else {
                this.$('.add_credit').removeClass('btn btn-success');
            }
        },
        add_currency_to_payment_line: function (line) {
            var order = this.pos.get_order();
            line = order.selected_paymentline;
            line.selected_currency = order.selected_currency;
        },
        render_paymentlines: function () {
            this._super();
            var order = this.pos.get_order();
            if (!order) {
                return;
            }
            var client = order.get_client();
            var wallet_register = _.find(this.pos.cashregisters, function (cashregister) { // Show || Hide Wallet method
                return cashregister.journal.pos_method_type == 'wallet';
            });
            if (wallet_register) {
                // if change amount > 0 or client wallet > 0, display payment method
                // else disable
                var change = order.get_change();
                var journal_id = wallet_register.journal.id;
                var $journal_element = $("[data-id='" + journal_id + "']");
                if (client && client['wallet'] > 0) {
                    $journal_element.removeClass('oe_hidden');
                    $journal_element.html('<span class="wallet">[Wallet card] ' + this.format_currency(client.wallet) + '</span>');
                } else {
                    $journal_element.addClass('oe_hidden');
                }
            }
            var credit_register = _.find(this.pos.cashregisters, function (cashregister) { // Show || Hide credit method
                return cashregister.journal['pos_method_type'] == 'credit';
            });
            if (credit_register) {
                if (!client || client.balance <= 0) {
                    var credit_journal_content = $("[data-id='" + credit_register.journal.id + "']");
                    credit_journal_content.addClass('oe_hidden');
                } else {
                    var credit_journal_content = $("[data-id='" + credit_register.journal.id + "']");
                    credit_journal_content.removeClass('oe_hidden');
                    credit_journal_content.html('<span >[Credit card] ' + this.format_currency(client.balance) + '</span>');
                }
            }
            // Show || Hide Return method
            // find return journal inside this pos
            // if current order is not return order, hide journal
            var cash_register = _.find(this.pos.cashregisters, function (cashregister) {
                return cashregister.journal['pos_method_type'] == 'return';
            });
            if (cash_register && order) {
                var return_order_journal_id = cash_register.journal.id;
                var return_order_journal_content = $("[data-id='" + return_order_journal_id + "']");
                if (!order['is_return']) {
                    return_order_journal_content.addClass('oe_hidden');
                } else {
                    return_order_journal_content.removeClass('oe_hidden');
                }
            }
            // Show || Hide Voucher method
            // find voucher journal inside this pos
            // and hide this voucher element, because if display may be made seller confuse
            var voucher_journal = _.find(this.pos.cashregisters, function (cashregister) {
                return cashregister.journal['pos_method_type'] == 'voucher';
            });
            if (voucher_journal) {
                var voucher_journal_id = voucher_journal.journal.id;
                var voucher_journal_content = $("[data-id='" + voucher_journal_id + "']");
                voucher_journal_content.addClass('oe_hidden');
            }
        },
        // Active device scan barcode voucher
        show: function () {
            var self = this;
            this._super();
            this.pos.barcode_reader.set_action_callback({
                'voucher': _.bind(self.barcode_voucher_action, self),
            });
        },
        // scan voucher viva device
        barcode_voucher_action: function (datas) {
            var self = this;
            this.datas_code = datas;
            rpc.query({
                model: 'pos.voucher',
                method: 'get_voucher_by_code',
                args: [datas['code']],
            }).then(function (voucher) {
                if (voucher == -1) {
                    self.barcode_error_action(self.datas_code);
                    return false;
                } else {
                    var current_order = self.pos.get('selectedOrder');
                    current_order.voucher_id = voucher.id;
                    var voucher_register = _.find(self.pos.cashregisters, function (cashregister) {
                        return cashregister.journal['pos_method_type'] == 'voucher';
                    });
                    if (voucher_register) {
                        if (voucher['customer_id'] && voucher['customer_id'][0]) {
                            var client = self.pos.db.get_partner_by_id(voucher['customer_id'][0]);
                            if (client) {
                                current_order.set_client(client)
                            }
                        }
                        var amount = 0;
                        if (voucher['apply_type'] == 'fixed_amount') {
                            amount = voucher.value;
                        } else {
                            amount = current_order.get_total_with_tax() / 100 * voucher.value;
                        }
                        // remove old paymentline have journal is voucher
                        var paymentlines = current_order.paymentlines;
                        for (var i = 0; i < paymentlines.models.length; i++) {
                            var payment_line = paymentlines.models[i];
                            if (payment_line.cashregister.journal['pos_method_type'] == 'voucher') {
                                payment_line.destroy();
                            }
                        }
                        // add new payment with this voucher just scanned
                        var voucher_paymentline = new models.Paymentline({}, {
                            order: current_order,
                            cashregister: voucher_register,
                            pos: self.pos
                        });
                        voucher_paymentline.set_amount(amount);
                        current_order.paymentlines.add(voucher_paymentline);
                        current_order.trigger('change', current_order)
                        self.render_paymentlines();
                        self.$('.paymentline.selected .edit').text(self.format_currency_no_symbol(amount));
                    } else {
                        self.gui.show_popup('notify_popup', {
                            title: 'ERROR',
                            from: 'top',
                            align: 'center',
                            body: 'Please create 1 Journal Method with POS method type is Voucher, add to pos config, close session and re-start session.',
                            color: 'danger',
                            timer: 1000
                        });
                        return;
                    }

                }
            }).fail(function (type, error) {
                return self.pos.query_backend_fail(type, error);
            });
            return true;
        }
        ,
        click_paymentmethods: function (id) {
            // id : id of journal
            var self = this;
            this._super(id);
            var order = this.pos.get_order();
            var selected_paymentline = order.selected_paymentline;
            var client = order.get_client();

            // if credit, wallet: require choice client the first
            if (selected_paymentline && selected_paymentline.cashregister && selected_paymentline.cashregister.journal['pos_method_type'] && (selected_paymentline.cashregister.journal['pos_method_type'] == 'wallet' || selected_paymentline.cashregister.journal['pos_method_type'] == 'credit') && !client) {
                return setTimeout(function () {
                    self.pos.gui.show_screen('clientlist');
                }, 30);
            }
            // method wallet
            var wallet_register_selected = _.find(this.pos.cashregisters, function (register) {
                return register.journal['pos_method_type'] == 'wallet' || register.journal['id'];
            });
            if (client && wallet_register_selected && selected_paymentline) {
                var change = order.get_change();
                selected_paymentline.set_amount(change);
            }
        },
        validate_order: function (force_validation) {
            var self = this;
            var order = this.pos.get_order();
            var wallet = 0;
            var use_wallet = false;
            var credit = 0;
            var use_credit = false;
            var payments_lines = order.paymentlines.models;
            var client = this.pos.get_order().get_client();
            if (client) {
                for (var i = 0; i < payments_lines.length; i++) {
                    var payment_line = payments_lines[i];
                    if (payment_line.cashregister.journal['pos_method_type'] && payment_line.cashregister.journal['pos_method_type'] == 'wallet') {
                        wallet += payment_line.get_amount();
                        use_wallet = true;
                    }
                    if (payment_line.cashregister.journal['pos_method_type'] && payment_line.cashregister.journal['pos_method_type'] == 'credit') {
                        credit += payment_line.get_amount();
                        use_credit = true;
                    }
                }
                if (client['wallet'] < wallet && use_wallet == true) {
                    return this.pos.gui.show_popup('alert_confirm', {
                        title: _t('Error'),
                        body: 'You can not set wallet bigger than ' + this.format_currency(client['wallet']),
                        confirmButtonText: 'Ok',
                        cancelButtonText: 'No, close',
                        confirm: function () {
                            return self.pos.gui.close_popup();
                        },
                        cancel: function () {
                            return self.pos.gui.close_popup();
                        }
                    })
                }
                if ((client['balance'] - credit < 0) && use_credit == true) {
                    return this.pos.gui.show_popup('alert_confirm', {
                        title: _t('Error'),
                        body: 'Balance debit/credit current of customer only have : ' + client['balance'],
                        confirmButtonText: 'Ok',
                        cancelButtonText: 'No, close',
                        confirm: function () {
                            return self.pos.gui.close_popup();
                        },
                        cancel: function () {
                            return self.pos.gui.close_popup();
                        }
                    })
                }
            }
            var res = this._super(force_validation);
            return res;
        },
    });

    // receipt screeen review
    // review receipt
    // receipt review
    var receipt_review = screens.ScreenWidget.extend({
        template: 'receipt_review',
        show: function () {
            this._super();
            var self = this;
            this.render_change();
            this.render_receipt();
            this.handle_auto_print();
        },
        handle_auto_print: function () {
            if (this.should_auto_print()) {
                this.print();
            } else {
                this.lock_screen(false);
            }
        },
        should_auto_print: function () {
            return this.pos.config.iface_print_auto && !this.pos.get_order()._printed;
        },
        should_close_immediately: function () {
            return this.pos.config.iface_print_via_proxy && this.pos.config.iface_print_skip_screen;
        },
        lock_screen: function (locked) {
            this._locked = locked;
            if (locked) {
                this.$('.back').removeClass('highlight');
            } else {
                this.$('.back').addClass('highlight');
            }
        },
        get_receipt_render_env: function () {
            var order = this.pos.get_order();
            return {
                widget: this,
                pos: this.pos,
                order: order,
                receipt: order.export_for_printing(),
                orderlines: order.get_orderlines(),
                paymentlines: order.get_paymentlines(),
            };
        },
        print_web: function () {
            window.print();
            this.pos.get_order()._printed = true;
        },
        print_xml: function () {
            var env = this.get_receipt_render_env();
            var receipt;
            if (this.pos.config.receipt_without_payment_template == 'display_price') {
                receipt = qweb.render('XmlReceipt', env);
            } else {
                receipt = qweb.render('xml_receipt_not_show_price', env);
            }
            this.pos.proxy.print_receipt(receipt);
            this.pos.get_order()._printed = true;
        },
        print: function () {
            var self = this;

            if (!this.pos.config.iface_print_via_proxy) { // browser (html) printing
                this.lock_screen(true);
                setTimeout(function () {
                    self.lock_screen(false);
                }, 1000);
                this.print_web();
            } else {    // proxy (xml) printing
                this.print_xml();
                this.lock_screen(false);
            }
        },

        click_back: function () {
            this.pos.gui.show_screen('products')
        },
        renderElement: function () {
            var self = this;
            this._super();
            this.$('.back').click(function () {
                if (!self._locked) {
                    self.click_back();
                }
            });
            this.$('.button.print').click(function () {
                if (!self._locked) {
                    self.print();
                }
            });
        },
        render_change: function () {
            this.$('.change-value').html(this.format_currency(this.pos.get_order().get_change()));
        },
        render_receipt: function () {
            this.$('.pos-receipt-container').html(qweb.render('pos_ticket_review', this.get_receipt_render_env()));
        }
    });

    gui.define_screen({name: 'receipt_review', widget: receipt_review});

    return {
        login_page: login_page
    };


});
