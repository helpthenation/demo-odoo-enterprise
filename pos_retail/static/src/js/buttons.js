odoo.define('pos_retail.buttons', function (require) {

    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var utils = require('web.utils');
    var round_pr = utils.round_precision;
    var _t = core._t;
    var rpc = require('pos.rpc');
    var qweb = core.qweb;
    var WebClient = require('web.AbstractWebClient');

    // voucher button
    var button_print_voucher = screens.ActionButtonWidget.extend({
        template: 'button_print_voucher',
        button_click: function () {
            this.gui.show_popup('popup_print_vouchers', {
                confirm: function () {
                    var self = this;
                    var period_days = parseFloat(this.$('.period_days').val());
                    var apply_type = this.$('.apply_type').val();
                    var voucher_amount = parseFloat(this.$('.voucher_amount').val());
                    var quantity_create = parseInt(this.$('.quantity_create').val());
                    var method = this.$('.method').val();
                    var customer = this.pos.get_order().get_client();
                    if (method == "special_customer" && !customer) {
                        this.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Because apply to Special customer, required select customer the first',
                            timer: 3000
                        })
                        return self.pos.gui.show_screen('clientlist')
                    }
                    if (typeof period_days != 'number' || isNaN(period_days)) {
                        return this.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Wrong format, Period days is required and format is Float',
                            timer: 3000
                        })
                    }
                    if (typeof voucher_amount != 'number' || isNaN(voucher_amount)) {
                        return this.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Amount is required and format is Float',
                            timer: 3000
                        })
                    }
                    if (typeof quantity_create != 'number' || isNaN(quantity_create)) {
                        return this.pos.gui.show_popup('alert_result', {
                            title: 'Warning',
                            body: 'Quantity voucher will create is required and format is Number or float',
                            timer: 3000
                        })
                    }
                    var voucher_data = {
                        apply_type: apply_type,
                        value: voucher_amount,
                        method: method,
                        period_days: period_days,
                        total_available: quantity_create
                    };
                    if (customer) {
                        voucher_data['customer_id'] = customer['id'];
                    }
                    rpc.query({
                        model: 'pos.voucher',
                        method: 'create_voucher',
                        args: [voucher_data]
                    }).then(function (vouchers) {
                        self.pos.vouchers = vouchers;
                        self.pos.gui.show_screen('vouchers_screen');
                    }).fail(function (type, error) {
                        return self.pos.query_backend_fail(type, error);
                    });
                    return this.gui.close_popup();
                },
                cancel: function () {
                    return this.gui.close_popup();
                }
            });

        }
    });
    screens.define_action_button({
        'name': 'button_print_voucher',
        'widget': button_print_voucher,
        'condition': function () {
            return this.pos.config.print_voucher;
        }
    });

    var button_promotion = screens.ActionButtonWidget.extend({// promotion button
        template: 'button_promotion',
        button_click: function () {
            var order = this.pos.get('selectedOrder');
            if (order) {
                order.compute_promotion()
            }
        }
    });
    screens.define_action_button({
        'name': 'button_promotion',
        'widget': button_promotion,
        'condition': function () {
            return this.pos.config.promotion == true && this.pos.promotion_ids.length && this.pos.promotion_ids.length >= 1;
        }
    });

    var button_combo = screens.ActionButtonWidget.extend({ // combo button
        template: 'button_combo',
        button_click: function () {
            var selected_orderline = this.pos.get_order().selected_orderline;
            if (!selected_orderline) {
                return;
            } else {
                selected_orderline.change_combo()
            }

        }
    });

    screens.define_action_button({
        'name': 'button_combo',
        'widget': button_combo,
        'condition': function () {
            return this.pos.combo_items && this.pos.combo_items.length > 0;
        }
    });

    var button_combo_item_add_lot = screens.ActionButtonWidget.extend({ // add lot to combo items
        template: 'button_combo_item_add_lot',

        button_click: function () {
            var selected_orderline = this.pos.get_order().selected_orderline;
            if (!selected_orderline) {
                this.gui.show_popup('notify_popup', {
                    title: 'Error',
                    from: 'top',
                    align: 'center',
                    body: 'Please selected line before add lot',
                    color: 'danger',
                    timer: 1000
                });
                return;
            } else {
                this.pos.gui.show_popup('popup_add_lot_to_combo_items', {
                    'title': _t('Lot/Serial Number(s) Combo Items'),
                    'combo_items': selected_orderline['combo_items'],
                    'orderline': selected_orderline,
                    'widget': this,
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'button_combo_item_add_lot',
        'widget': button_combo_item_add_lot,
        'condition': function () {
            return this.pos.combo_items && this.pos.combo_items.length > 0;
        }
    });

    var button_global_discount = screens.ActionButtonWidget.extend({ // global discounts
        template: 'button_global_discount',
        button_click: function () {
            var list = [];
            var self = this;
            for (var i = 0; i < this.pos.discounts.length; i++) {
                var discount = this.pos.discounts[i];
                list.push({
                    'label': discount.name,
                    'item': discount
                });
            }

            this.gui.show_popup('selection', {
                title: _t('Select discount'),
                list: list,
                confirm: function (discount) {
                    var order = self.pos.get('selectedOrder');
                    var total_with_tax = order.get_total_with_tax();
                    var product = self.pos.db.product_by_id[discount.product_id[0]]
                    var price = total_with_tax / 100 * discount['amount']
                    order.add_product(product, {
                        price: -price
                    })
                    var selected_line = order.get_selected_orderline();
                    selected_line.trigger('update:OrderLine', selected_line);
                    selected_line.trigger('change', selected_line);
                }
            });
        }
    });
    screens.define_action_button({
        'name': 'button_global_discount',
        'widget': button_global_discount,
        'condition': function () {
            return this.pos.config.discount;
        }
    });

    var button_create_internal_transfer = screens.ActionButtonWidget.extend({  // internal transfer
        template: 'button_create_internal_transfer',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            var length = order.orderlines.length;
            if (length == 0) {
                return this.gui.show_popup('alert_confirm', {
                    title: 'Error',
                    body: 'Your order is empty',
                    confirmButtonText: 'Yes',
                    cancelButtonText: 'Close',
                    confirm: function () {
                        return self.pos.gui.close_popup();
                    },
                    cancel: function () {
                        return self.pos.gui.close_popup();
                    }
                });
            } else {
                this.gui.show_popup('popup_internal_transfer', {})
            }
        }
    });

    screens.define_action_button({
        'name': 'button_create_internal_transfer',
        'widget': button_create_internal_transfer,
        'condition': function () {
            return this.pos.config.internal_transfer == true;
        }
    });

    var button_go_invoice_screen = screens.ActionButtonWidget.extend({
        template: 'button_go_invoice_screen',
        button_click: function () {
            this.gui.show_screen('invoices');
        },
    });
    screens.define_action_button({
        'name': 'button_go_invoice_screen',
        'widget': button_go_invoice_screen,
        'condition': function () {
            return this.pos.config.management_invoice == true;
        }
    });
    var button_kitchen_receipt_screen = screens.ActionButtonWidget.extend({
        template: 'button_kitchen_receipt_screen',
        button_click: function () {
            var order = this.pos.get('selectedOrder');
            if (order && order.orderlines.length) {
                this.pos.gui.show_screen('kitchen_receipt_screen');
            }
        }
    });
    screens.define_action_button({
        'name': 'button_kitchen_receipt_screen',
        'widget': button_kitchen_receipt_screen,
        'condition': function () {
            return this.pos.printers && this.pos.printers.length;
        }
    });

    var button_lock_screen = screens.ActionButtonWidget.extend({
        template: 'button_lock_screen',
        button_click: function () {
            this.gui.show_screen('login_page');
        }
    });
    screens.define_action_button({
        'name': 'button_lock_screen',
        'widget': button_lock_screen,
        'condition': function () {
            return this.pos.config.allow_lock_screen == true;
        }
    });
    var reward_button = screens.ActionButtonWidget.extend({
        template: 'reward_button',
        validate_loyalty: function (order, reward, amount_with_tax, total_redeem_point) {
            var client = order.get_client();
            if (reward['min_amount'] > amount_with_tax) {
                this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Reward ' + reward['name'] + ' required min amount bigger than ' + reward['min_amount'],
                    timer: 5000
                })
            }
            if (client['pos_loyalty_point'] <= total_redeem_point) {
                this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Point of customer not enough',
                    timer: 5000
                })
            }
            if ((reward['type'] == 'discount_products' || reward['type'] == 'discount_categories') && reward['discount'] <= 0) {
                this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Reward ' + reward['name'] + ' have discount amount is 0, could not apply',
                    timer: 5000
                })
            }
        },
        set_redeem_point: function (line, new_price, redeem_point, rounding) {
            line.plus_point = 0;
            line.redeem_point = round_pr(redeem_point, rounding);
            if (new_price != null) {
                line.set_unit_price(new_price)
            }
            line.trigger('change', line);
            line.trigger_update_line();
        },
        button_click: function () {
            var list = [];
            var self = this;
            var order = self.pos.get('selectedOrder');
            var client = order.get_client();
            if (!client) {
                return setTimeout(function () {
                    self.pos.gui.show_screen('clientlist');
                }, 1);
            }
            for (var i = 0; i < this.pos.rewards.length; i++) {
                var item = this.pos.rewards[i];
                list.push({
                    'label': item['name'],
                    'item': item
                });
            }
            if (list.length > 0) {
                this.gui.show_popup('selection', {
                    title: _t('Please select Reward program'),
                    list: list,
                    confirm: function (reward) {
                        var applied = false;
                        var lines = order.orderlines.models;
                        var amount_with_tax = order.get_total_with_tax();
                        var total_redeem_point = order.build_redeem_point();
                        self.validate_loyalty(order, reward, amount_with_tax, total_redeem_point);
                        if (reward['type'] == 'discount_products') {
                            for (var i = 0; i < lines.length; i++) {
                                var curr_line = lines[i];
                                if (reward['discount_product_ids'].indexOf(curr_line['product']['id']) != -1) {
                                    var price = curr_line.get_price_with_tax();
                                    var point_will_redeem = price / 100 * reward['discount'] * reward['coefficient']
                                    point_will_redeem = round_pr(point_will_redeem, reward['rounding'])
                                    var next_redeem_point = total_redeem_point + point_will_redeem;
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        console.error('limit point')
                                        break; // dừng vòng lặp khi quá point
                                    } else {
                                        var new_price = price - (price / 100 * reward['discount']);
                                        self.set_redeem_point(curr_line, new_price, point_will_redeem, reward['rounding'])
                                        applied = true;
                                    }
                                }
                            }
                        }
                        else if (reward['type'] == 'discount_categories') {
                            for (var i = 0; i < lines.length; i++) {
                                var curr_line = lines[i];
                                if (reward['discount_category_ids'].indexOf(curr_line['product']['pos_categ_id'][0]) != -1) {
                                    var price = curr_line.get_price_with_tax();
                                    var point_will_redeem = price / 100 * reward['discount'] * reward['coefficient']
                                    point_will_redeem = round_pr(point_will_redeem, reward['rounding'])
                                    var next_redeem_point = total_redeem_point + point_will_redeem;
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        console.error('limit point')
                                        break; // dừng vòng lặp khi quá point
                                    } else {
                                        var new_price = price - (price / 100 * reward['discount']);
                                        self.set_redeem_point(curr_line, new_price, point_will_redeem, reward['rounding'])
                                        applied = true;
                                    }
                                }
                            }
                        }
                        else if (reward['type'] == 'gift') {
                            for (item_index in reward['gift_product_ids']) {
                                var product = self.pos.db.get_product_by_id(reward['gift_product_ids'][item_index])
                                if (product) {
                                    var point_will_redeem = product['list_price'] * reward['coefficient'];
                                    var next_redeem_point = total_redeem_point + point_will_redeem;
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        console.error('limit point')
                                        break; // dừng vòng lặp khi quá point
                                    } else {
                                        order.add_product(product, {
                                            quantity: reward['quantity'],
                                            price: 0,
                                            merge: true,
                                        });
                                        var selected_line = order.get_selected_orderline();
                                        self.set_redeem_point(selected_line, null, point_will_redeem, reward['rounding'])
                                        applied = true;
                                    }
                                }
                            }
                        }
                        else if (reward['type'] == 'resale') {
                            for (var i = 0; i < lines.length; i++) {
                                var curr_line = lines[i];
                                if (reward['resale_product_ids'].indexOf(curr_line['product']['id']) != -1) {
                                    var product = curr_line.product
                                    var price = product['list_price']
                                    var point_will_redeem = price - reward['price_resale'] * reward['coefficient'];
                                    var next_redeem_point = total_redeem_point + point_will_redeem;
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        console.error('limit point')
                                        break; // dừng vòng lặp khi quá point
                                    } else {
                                        self.set_redeem_point(curr_line, reward['price_resale'], point_will_redeem, reward['rounding']);
                                        applied = true;
                                    }
                                }
                            }
                        }
                        else if (reward['type'] == 'resale') {
                            for (var i = 0; i < lines.length; i++) {
                                var curr_line = lines[i];
                                if (reward['resale_product_ids'].indexOf(curr_line['product']['id']) != -1) {
                                    var product = curr_line.product
                                    var price = product['list_price']
                                    var point_will_redeem = price - reward['price_resale'] * reward['coefficient'];
                                    var next_redeem_point = total_redeem_point + point_will_redeem;
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        console.error('limit point')
                                        break; // dừng vòng lặp khi quá point
                                    } else {
                                        self.set_redeem_point(curr_line, reward['price_resale'], point_will_redeem, reward['rounding'])
                                        applied = true;
                                    }
                                }
                            }
                        }
                        else if (reward['type'] == 'use_point_payment') {
                            self.gui.show_popup('number', {
                                'title': _t('How many point customer need use ?'),
                                'value': self.format_currency_no_symbol(0),
                                'confirm': function (point) {
                                    var total_redeem_point = order.build_redeem_point();
                                    var next_redeem_point = total_redeem_point + parseFloat(point);
                                    if (client['pos_loyalty_point'] < next_redeem_point) {
                                        return self.gui.show_popup('alert_result', {
                                            title: 'ERROR',
                                            body: 'You can not add total point bigger than: ' + (client['pos_loyalty_point'] - total_redeem_point),
                                            timer: 2000,
                                            confirm: function () {
                                                return self.gui.close_popup();
                                            }
                                        });

                                    } else {
                                        var loyalty_id = reward['loyalty_id'][0];
                                        var loyalty = self.pos.loyalty_by_id[loyalty_id];
                                        if (loyalty) {
                                            var product_id = loyalty['product_loyalty_id'][0];
                                            var product = self.pos.db.get_product_by_id(product_id);
                                            if (product) {
                                                var next_amount = amount_with_tax - point * reward['coefficient'];
                                                if (next_amount >= 0) {
                                                    order.add_product(product, {
                                                        quantity: -1,
                                                        price: point * reward['coefficient'],
                                                        merge: false,
                                                    });
                                                    var selected_line = order.get_selected_orderline();
                                                    self.set_redeem_point(selected_line, null, point, reward['rounding'])
                                                    applied = true;
                                                } else {
                                                    return self.gui.show_popup('alert_result', {
                                                        title: 'ERROR',
                                                        body: 'Can not apply this reward because when applied , amount of order will smaller than 0',
                                                        timer: 4000,
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        if (applied) {
                            order.trigger('change', order);
                            return self.gui.show_popup('alert_result', {
                                title: 'Succeed',
                                body: 'Order applied reward succeed',
                            });
                        } else {
                            return self.gui.show_popup('alert_result', {
                                title: 'Warning',
                                body: 'This order have not enough conditions apply reward program just selected',
                                timer: 4000,
                            });
                        }


                    }
                });
            } else {
                return this.gui.show_popup('alert_result', {
                    title: 'ERROR',
                    body: 'Have not any reward programs active',
                    timer: 2000,
                    confirm: function () {
                        return self.gui.close_popup();
                    }
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'reward_button',
        'widget': reward_button,
        'condition': function () {
            return this.pos.rules && this.pos.rules.length && this.pos.rules.length > 0;
        }
    });

    var button_create_purchase_order = screens.ActionButtonWidget.extend({
        template: 'button_create_purchase_order',
        button_click: function () {
            this.gui.show_popup('popup_create_purchase_order', {
                title: 'Create Purchase Order',
                widget: this,
                cashregisters: this.pos.cashregisters
            });
        }
    });

    screens.define_action_button({
        'name': 'button_create_purchase_order',
        'widget': button_create_purchase_order,
        'condition': function () {
            return this.pos.config.create_purchase_order && this.pos.config.purchase_order_state;
        }
    });

    var button_change_unit = screens.ActionButtonWidget.extend({ // multi unit of measure
        template: 'button_change_unit',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            var selected_orderline = order.selected_orderline;
            if (order) {
                if (selected_orderline) {
                    selected_orderline.change_unit();
                } else {
                    return this.gui.show_popup('alert_result', {
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
                return this.gui.show_popup('alert_result', {
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
        }
    });
    screens.define_action_button({
        'name': 'button_change_unit',
        'widget': button_change_unit,
        'condition': function () {
            return false; // hide
        }
    });
    var button_go_pos_orders_screen = screens.ActionButtonWidget.extend({
        template: 'button_go_pos_orders_screen',
        button_click: function () {
            this.gui.show_screen('pos_orders_screen');
        }
    });
    screens.define_action_button({
        'name': 'button_go_pos_orders_screen',
        'widget': button_go_pos_orders_screen,
        'condition': function () {
            return this.pos.config.pos_orders_management == true;
        }
    });
    var button_set_tags = screens.ActionButtonWidget.extend({
        template: 'button_set_tags',
        button_click: function () {
            if (!this.pos.tags || this.pos.tags.length == 0) {
                return this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Empty tags, please go to Retail [menu] / Tags and create',
                    confirm: function () {
                        return this.gui.close_popup();
                    },
                    cancel: function () {
                        return this.gui.close_popup();
                    }
                });
            }
            if (this.pos.get_order().selected_orderline && this.pos.tags && this.pos.tags.length > 0) {
                return this.gui.show_popup('popup_selection_tags', {
                    selected_orderline: this.pos.get_order().selected_orderline,
                    title: 'Add tags'
                });
            } else {
                return this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Please select linne',
                    confirm: function () {
                        return this.gui.close_popup();
                    },
                    cancel: function () {
                        return this.gui.close_popup();
                    }
                });
            }
        }
    });

    screens.define_action_button({
        'name': 'button_set_tags',
        'widget': button_set_tags,
        'condition': function () {
            return false; // hide
        }
    });
    var button_register_payment = screens.ActionButtonWidget.extend({
        template: 'button_register_payment',
        button_click: function () {
            this.chrome.do_action('account.action_account_payment_from_invoices', {
                additional_context: {
                    active_ids: [3]
                }
            });
        }
    });

    screens.define_action_button({
        'name': 'button_register_payment',
        'widget': button_register_payment,
        'condition': function () {
            return false;
        }
    });
    var product_operation_button = screens.ActionButtonWidget.extend({
        template: 'product_operation_button',
        button_click: function () {
            this.gui.show_screen('productlist');
        }
    });

    screens.define_action_button({
        'name': 'product_operation_button',
        'widget': product_operation_button,
        'condition': function () {
            return this.pos.config.product_operation;
        }
    });
    var button_add_variants = screens.ActionButtonWidget.extend({
        template: 'button_add_variants',
        init: function (parent, options) {
            this._super(parent, options);
            this.pos.get('orders').bind('add change', function () {
                this.renderElement();
            }, this);
            this.pos.bind('change:selectedOrder', function () {
                this.renderElement();
            }, this);
        },
        button_click: function () {
            var selected_orderline = this.pos.get_order().selected_orderline;
            if (!selected_orderline) {
                this.pos.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Please select line',
                })
            } else {
                if (this.pos.variant_by_product_tmpl_id[selected_orderline.product.product_tmpl_id]) {
                    this.gui.show_popup('popup_selection_variants', {
                        title: 'Select variants',
                        variants: this.pos.variant_by_product_tmpl_id[selected_orderline.product.product_tmpl_id],
                        selected_orderline: selected_orderline
                    })
                } else {
                    this.pos.gui.show_popup('alert_result', {
                        title: 'Warning',
                        body: 'Line selected have not variants, please go to Product menu, add variants values.',
                    })
                }
            }
        }
    });

    screens.define_action_button({
        'name': 'button_add_variants',
        'widget': button_add_variants,
        'condition': function () {
            return this.pos.variants && this.pos.variants.length > 0;
        }
    });
    var button_print_receipt = screens.ActionButtonWidget.extend({
        template: 'button_print_receipt',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            if (!order || order.orderlines.length == 0) {
                return this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Your Order blank'
                });
            }
            if (this.pos.config.lock_order_printed_receipt) {
                return this.gui.show_popup('alert_confirm', {
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

        }
    });
    screens.define_action_button({
        'name': 'button_print_receipt',
        'widget': button_print_receipt,
        'condition': function () {
            return false; // hide
        }
    });

    var button_order_signature = screens.ActionButtonWidget.extend({
        template: 'button_order_signature',
        button_click: function () {
            var order = this.pos.get_order();
            if (order) {
                this.gui.show_popup('popup_order_signature', {
                    order: order,
                    title: 'Signature'
                });
            }
        }
    });
    screens.define_action_button({
        'name': 'button_order_signature',
        'widget': button_order_signature,
        'condition': function () {
            return false; // hide
        }
    });

    // var button_print_test = screens.ActionButtonWidget.extend({
    //     template: 'button_print_test',
    //     button_click: function () {
    //         var order = this.pos.get_order();
    //         var env = {
    //             widget: this,
    //             pos: this.pos,
    //             order: order,
    //             receipt: order.export_for_printing(),
    //             orderlines: order.get_orderlines(),
    //             paymentlines: order.get_paymentlines()
    //         };
    //         var receipt = qweb.render('XmlReceipt', env);
    //         this.pos.gui.show_popup('popup_print_receipt', {
    //             xml: receipt
    //         });
    //     }
    // });
    // screens.define_action_button({
    //     'name': 'button_print_test',
    //     'widget': button_print_test,
    //     'condition': function () {
    //         return true
    //     }
    // });
    var button_order_note = screens.ActionButtonWidget.extend({
        template: 'button_order_note',
        button_click: function () {
            var order = this.pos.get_order();
            if (order) {
                this.gui.show_popup('textarea', {
                    title: _t('Add Note'),
                    value: order.get_note(),
                    confirm: function (note) {
                        order.set_note(note);
                        order.trigger('change', order);
                    }
                });
            }
        }
    });
    screens.define_action_button({
        'name': 'button_order_note',
        'widget': button_order_note,
        'condition': function () {
            return false; // hide
        }
    });

    var button_line_note = screens.ActionButtonWidget.extend({
        template: 'button_line_note',
        button_click: function () {
            var line = this.pos.get_order().get_selected_orderline();
            if (line) {
                this.gui.show_popup('popup_add_order_line_note', {
                    title: _t('Add Note'),
                    value: line.get_line_note(),
                    confirm: function (note) {
                        line.set_line_note(note);
                    }
                });
            } else {
                this.pos.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Please select line the first'
                })
            }
        }
    });

    screens.define_action_button({
        'name': 'button_line_note',
        'widget': button_line_note,
        'condition': function () {
            return false; // hide
        }
    });
    var button_selection_pricelist = screens.ActionButtonWidget.extend({ // version 10 only
        template: 'button_selection_pricelist',
        init: function (parent, options) {
            this._super(parent, options);
            this.pos.get('orders').bind('add change', function () {
                this.renderElement();
            }, this);
            this.pos.bind('change:selectedOrder', function () {
                this.renderElement();
                var order = this.pos.get_order();
                if (order && order.pricelist) {
                    order.set_pricelist_to_order(order.pricelist);
                }
            }, this);
        },
        button_click: function () {
            var self = this;
            var pricelists = _.map(self.pos.pricelists, function (pricelist) {
                return {
                    label: pricelist.name,
                    item: pricelist
                };
            });
            self.gui.show_popup('selection', {
                title: _t('Choice one pricelist'),
                list: pricelists,
                confirm: function (pricelist) {
                    self.pos.gui.close_popup();
                    var order = self.pos.get_order();
                    order.set_pricelist_to_order(pricelist);
                },
                is_selected: function (pricelist) {
                    return pricelist.id === self.pos.get_order().pricelist.id;
                }
            });
        },
        get_order_pricelist: function () {
            var name = _t('Pricelist Item');
            var order = this.pos.get_order();
            if (order) {
                var pricelist = order.pricelist;
                if (pricelist) {
                    name = pricelist.display_name;
                }
            }
            return name;
        }
    });

    screens.define_action_button({
        'name': 'button_selection_pricelist',
        'widget': button_selection_pricelist,
        'condition': function () {
            return (this.pos.version['server_serie'] == "10.0" || this.pos.version['server_serie'] == "10.0+e") && this.pos.pricelists && this.pos.pricelists.length > 0;
        }
    });

    var button_return_products = screens.ActionButtonWidget.extend({
        template: 'button_return_products',
        button_click: function () {
            this.gui.show_screen('return_products');
        }
    });

    screens.define_action_button({
        'name': 'button_return_products',
        'widget': button_return_products,
        'condition': function () {
            return this.pos.config.return_products == true;
        }
    });

    var button_lock_unlock_order = screens.ActionButtonWidget.extend({
        template: 'button_lock_unlock_order',
        button_click: function () {
            var order = this.pos.get_order();
            order['lock'] = !order['lock'];
            order.trigger('change', order);
            if (this.pos.pos_bus) {
                var action;
                if (order['lock']) {
                    action = 'lock_order';
                } else {
                    action = 'unlock_order';
                }
                this.pos.pos_bus.push_message_to_other_sessions({
                    data: order.uid,
                    action: action,
                    bus_id: this.pos.config.bus_id[0],
                    order_uid: order['uid']
                });
            } else {
                this.pos.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: 'Syncing between sessions not active'
                })
            }
        }
    });

    screens.define_action_button({
        'name': 'button_lock_unlock_order',
        'widget': button_lock_unlock_order,
        'condition': function () {
            return this.pos.config.lock_order_printed_receipt == true;
        }
    });

    var button_print_user_card = screens.ActionButtonWidget.extend({
        template: 'button_print_user_card',
        button_click: function () {
            var user_card_xml = qweb.render('user_card_xml', {
                user: this.pos.get_cashier()
            });
            this.pos.proxy.print_receipt(user_card_xml);
            return this.pos.gui.show_popup('alert_result', {
                title: 'Hi',
                body: 'please get user card at your printer'
            })

        }
    });

    screens.define_action_button({
        'name': 'button_print_user_card',
        'widget': button_print_user_card,
        'condition': function () {
            return this.pos.config.print_user_card == true;
        }
    });

    var button_daily_report = screens.ActionButtonWidget.extend({
        template: 'button_daily_report',
        button_click: function () {
            this.pos.gui.show_screen('daily_report');

        }
    });

    screens.define_action_button({
        'name': 'button_daily_report',
        'widget': button_daily_report,
        'condition': function () {
            return false; // hide
        }
    });

    var button_clear_order = screens.ActionButtonWidget.extend({
        template: 'button_clear_order',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var orders = this.pos.get('orders');
            for (var i = 0; i < orders.models.length; i++) {
                var order = orders.models[i];
                if (order.orderlines.models.length == 0) {
                    order.destroy({'reason': 'abandon'});
                }
            }
        }
    });
    screens.define_action_button({
        'name': 'button_clear_order',
        'widget': button_clear_order,
        'condition': function () {
            return false; // hide
        }
    });

    var button_booking_order = screens.ActionButtonWidget.extend({
        template: 'button_booking_order',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            var pricelist = order['pricelist'];
            if (!pricelist) {
                pricelist = this.pos.default_pricelist;
            }
            var length = order.orderlines.length;
            if (!order.get_client()) {
                return setTimeout(function () {
                    self.pos.gui.show_screen('clientlist');
                }, 500);
            }
            if (length == 0) {
                return this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: "Your order lines is empty",
                    timer: 4000
                });
            }
            return this.gui.show_popup('popup_create_booking_order', {
                title: 'Create book order',
                pricelist: pricelist,
                order: order,
                client: order.get_client(),
            });
        }
    });
    screens.define_action_button({
        'name': 'button_booking_order',
        'widget': button_booking_order,
        'condition': function () {
            return this.pos.config.booking_orders;
        }
    });

    var button_go_sale_orders_screen = screens.ActionButtonWidget.extend({
        template: 'button_go_sale_orders_screen',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            this.pos.gui.show_screen('sale_orders');
        }
    });
    screens.define_action_button({
        'name': 'button_go_sale_orders_screen',
        'widget': button_go_sale_orders_screen,
        'condition': function () {
            return this.pos.config.delivery_orders == true;
        }
    });


    var button_create_sale_order = screens.ActionButtonWidget.extend({
        template: 'button_create_sale_order',
        button_click: function () {
            var self = this;
            var order = this.pos.get_order();
            var length = order.orderlines.length;
            if (!order.get_client()) {
                return self.pos.gui.show_screen('clientlist');
            }
            if (length == 0) {
                return this.gui.show_popup('alert_result', {
                    title: 'Warning',
                    body: "Your order lines is empty",
                    timer: 4000
                });
            }
            return this.gui.show_popup('popup_create_sale_order', {
                title: 'Create sale order',
                order: order,
                client: order.get_client(),
            });
        }
    });
    screens.define_action_button({
        'name': 'button_create_sale_order',
        'widget': button_create_sale_order,
        'condition': function () {
            return this.pos.config.sale_order;
        }
    });

    var button_delivery_order = screens.ActionButtonWidget.extend({
        template: 'button_delivery_order',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            this.pos.gui.show_screen('payment');
        }
    });
    screens.define_action_button({
        'name': 'button_delivery_order',
        'widget': button_delivery_order,
        'condition': function () {
            return this.pos.config.delivery_orders == true;
        }
    });


    var button_lock_session = screens.ActionButtonWidget.extend({
        template: 'button_lock_session',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            $('.pos-content').addClass('oe_hidden');
            return this.gui.show_popup('popup_lock_session', {
                title: 'Lock',
            });
        }
    });
    screens.define_action_button({
        'name': 'button_lock_session',
        'widget': button_lock_session,
        'condition': function () {
            return false; //hide
        }
    });

    var button_set_location = screens.ActionButtonWidget.extend({
        template: 'button_set_location',
        init: function (parent, options) {
            this._super(parent, options);
            this.locations_selected = null;
            this.pos.bind('change:location', function () {
                this.renderElement();
            }, this);
        },
        button_click: function () {
            var list = [];
            var self = this;
            for (var i = 0; i < this.pos.stock_locations.length; i++) {
                var location = this.pos.stock_locations[i];
                list.push({
                    'label': location.name,
                    'item': location
                });
            }
            this.gui.show_popup('selection', {
                title: _t('Check Location'),
                list: list,
                confirm: function (location) {
                    self.pos.set_location(location);
                    var order = self.pos.get_order();
                    if (order) {
                        order.location = location;
                        order.trigger('change', order);
                    }
                    self.locations_selected = location;
                    return rpc.query({
                        model: 'pos.cache.database',
                        method: 'get_on_hand_by_stock_location',
                        args: [location['id']],
                        context: {}
                    }).then(function (datas) {
                        for (var i = 0; i < self.pos.products.length; i++) {
                            var product = self.pos.products[i];
                            var qty_available = datas[product.id];
                            if (qty_available) {
                                var $product_el = $("[data-product-id='" + product.id + "'] .qty_available");
                                product['qty_available'] = qty_available;
                                $product_el.text(qty_available).show('fast');
                                if (qty_available > 0) {
                                    $("[data-product-id='" + product.id + "'] .fa-lock").toggleClass('fa-lock fa-certificate');
                                    $("[data-product-id='" + product.id + "'] .qty_not_available").toggleClass('qty_not_available qty_available');
                                } else {
                                    $("[data-product-id='" + product.id + "'] .fa-certificate").toggleClass('fa-certificate fa-lock');
                                    $("[data-product-id='" + product.id + "'] .qty_available").toggleClass('qty_available qty_not_available');
                                }
                            } else {
                                $("[data-product-id='" + product.id + "'] .qty_available").text('0').show('fast');;
                                $("[data-product-id='" + product.id + "'] .qty_not_available").text('0').show('fast');;
                                $("[data-product-id='" + product.id + "'] .qty_available").toggleClass('qty_available qty_not_available');
                                product['qty_available'] = 0;
                            }
                        }
                        self.pos.trigger('change:location');
                        return self.gui.show_popup('alert_result', {
                            title: 'Location: ' + self.locations_selected['name'] + ' selected.',
                            timer: 5000,
                        });
                    }).fail(function (type, error) {
                        return self.pos.query_backend_fail(type, error);
                    })
                }
            });
        }
    });
    screens.define_action_button({
        'name': 'button_set_location',
        'widget': button_set_location,
        'condition': function () {
            return this.pos.config.multi_location == true;
        }
    });

    var button_restart_session = screens.ActionButtonWidget.extend({
        template: 'button_restart_session',
        init: function (parent, options) {
            this._super(parent, options);
        },
        button_click: function () {
            var def = new $.Deferred();
            var list = [];
            var self = this;
            for (var i = 0; i < this.pos.configs.length; i++) {
                var config = this.pos.configs[i];
                if (config.id != this.pos.config['id']) {
                    list.push({
                        'label': config.user_id[1],
                        'item': config
                    });
                }
            }
            this.gui.show_popup('selection', {
                title: _t('Switch to user'),
                list: list,
                confirm: function (config) {
                    def.resolve(config);
                }
            });
            return def.then(function (config) {
                var user = self.pos.user_by_id[config.user_id[0]];
                if (user.pos_security_pin) {
                    return self.pos.gui.ask_password(user.pos_security_pin).then(function () {
                        var config_id = config.id;
                        self.pos.ParameterDB.save(self.pos.session.db + '_config_id', config_id);
                        var web_client = new WebClient();
                        web_client._title_changed = function () {
                        };
                        web_client.show_application = function () {
                            return web_client.action_manager.do_action("pos.ui");
                        };
                        $(function () {
                            web_client.setElement($(document.body));
                            web_client.start();
                        });
                        return web_client;
                    });
                } else {
                    var config_id = config.id;
                    self.pos.ParameterDB.save(self.pos.session.db + '_config_id', config_id);
                    var web_client = new WebClient();
                    web_client._title_changed = function () {
                    };
                    web_client.show_application = function () {
                        return web_client.action_manager.do_action("pos.ui");
                    };
                    $(function () {
                        web_client.setElement($(document.body));
                        web_client.start();
                    });
                    return web_client;
                }
            });
        }
    });
    screens.define_action_button({
        'name': 'button_restart_session',
        'widget': button_restart_session,
        'condition': function () {
            return true;
        }
    });

});
