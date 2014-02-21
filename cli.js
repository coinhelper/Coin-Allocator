#!/usr/bin/env node

/**
 * CLI Interface for Coin Allocator
 *
 * Todo:
 *  - Build proper CLI with optimist or the like
 *  - add --help command
 *  - require allocation targets from command line
 *  - require primary currency from command line
 *  - accept keys from cli in addition to env
 *  - add --no-execute option to suggest trades and exit
 *  - ask before making trades
 *  - add --yes option automatically make the trades without asking
 *  - (eventually) add --exchange param
 */

var readline = require('readline');
var util = require('util');
var _ = require('lodash');


// configuration
var publicKey = process.env.CRYPTSY_PUBLIC_KEY;
var privateKey = process.env.CRYPTSY_PRIVATE_KEY;

if (!publicKey || !privateKey) throw 'CRYPTSY_PUBLIC_KEY and CRYPTSY_PRIVATE_KEY env vars must be set';

var CoinAllocator = require('./CoinAllocator.js');

var ca = new CoinAllocator({
    currencies: ['BTC', 'LTC', 'DOGE'],
    primaryCurrency: 'BTC',
    publicKey: publicKey,
    privateKey: privateKey
});


console.log('fetching data...');
ca.getStatus(function(err, status) {
    if (err) {
        if (_.contains(err.message, '<html>')) {
            console.error(err.message);
            console.error('Remote API appears to be down, please try again in a few minutes\n');
            return process.exit(2);
        }
        console.error(err.stack || err);
        process.exit(1);

    }

    console.log("Current balances:", status.balances);
    console.log("Target after rebalancing:", status.targetBalances);
    var suggestedTrades = ca.getSuggestedTrades(status);
    if (!suggestedTrades.getTrades().length) {
        console.log('\nNo trades recommended at this time.\n');
        process.exit();
    }
    console.log("Suggested trades:\n", suggestedTrades.toString());

    var ordersOpen = false;

    function cancelAllOrders(cb) {
        console.warn('Canceling all outstanding orders...');
        ca.cancelAllOrders(function(err, cancelations) {
            if (err) {
                console.error('Error canceling orders: ', err);
                return process.exit(4);
            }
            console.log('Orders canceled: ', cancelations);
            if (cb) {
                cb();
            }
        });
        ordersOpen = false;
    }

    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    function handleResponse(response) {
        // todo: figure out how to kill the prompt and prevent/ignore additional user input after the first yes/no
        response = response.toLowerCase();
        if (response == 'yes') { // not sure why node wraps parenthesis around the command...
            ordersOpen = true;
            var error = false;
            console.log('Executing, press control-c to cancel and kill any outstanding orders');
            ca.executeTrades(suggestedTrades)
                .on('executing', function(trade, order, orderId) {
                    console.log('Executing trade:\n Trade: %s\n order: %s\n Order ID: %s', trade.toString(), order, orderId);
                    process.stdout.write('...');
                })
                .on('executed', function(trade, orderId) {
                    process.stdout.write('Done! Order ID: ', orderId);
                })
                .on('orderProgress', function(completed, total) {
                    process.stdout.clearLine();
                    process.stdout.write(util.format('%s/%s (%s%)', completed, total, Math.round(completed / total * 100)));
                })
                .on('error', function(err) {
                    console.error('Error executing trades:');
                    console.error(err);
                    cancelAllOrders(function() {
                        process.exit(3);
                    });
                })
                .on('done', function() {
                    ordersOpen = false;
                    if (!error) console.log('All trades executed!');
                    process.exit();
                });
        } else if (response == 'no') {
            process.exit();
        } else {
            rl.question('Please type "yes" or "no": ', handleResponse);
        }
    }
    rl.on('close', function() {
        if (ordersOpen) cancelAllOrders(function() {
            process.exit();
        });
    });
    rl.question('Execute these trades? (yes/no): ', handleResponse);
});
