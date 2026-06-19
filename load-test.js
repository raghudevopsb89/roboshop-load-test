import http from 'k6/http';
import { check, sleep, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const CATALOGUE_URL = __ENV.CATALOGUE_URL || 'http://localhost:8002';
const USER_URL = __ENV.USER_URL || 'http://localhost:8001';
const CART_URL = __ENV.CART_URL || 'http://localhost:8003';
const SHIPPING_URL = __ENV.SHIPPING_URL || 'http://localhost:8004';
const PAYMENT_URL = __ENV.PAYMENT_URL || 'http://localhost:8005';
const RATINGS_URL = __ENV.RATINGS_URL || 'http://localhost:8006';
const ORDERS_URL = __ENV.ORDERS_URL || 'http://localhost:8007';
const NOTIFICATION_URL = __ENV.NOTIFICATION_URL || 'http://localhost:8008';

export const options = {
    stages: [
        { duration: '30s', target: 10 },
        { duration: '1m',  target: 20 },
        { duration: '30s', target: 50 },  // spike - only specific services see load
        { duration: '30s', target: 0 },
    ],
    thresholds: {
        http_req_duration: ['p(95)<3000'],
        http_req_failed: ['rate<0.1'],
    },
};

const USERNAME = 'k6user_' + Math.random().toString(36).substring(7);
const PASSWORD = 'TestPass123';

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

// Hit /health on every service once at test start so a broken service fails fast
// instead of being hidden inside the iteration's noisier checks.
export function setup() {
    const services = [
        ['user', `${USER_URL}/health`],
        ['catalogue', `${CATALOGUE_URL}/health`],
        ['cart', `${CART_URL}/health`],
        ['shipping', `${SHIPPING_URL}/health`],
        ['payment', `${PAYMENT_URL}/health`],
        ['ratings', `${RATINGS_URL}/health`],
        ['orders', `${ORDERS_URL}/health`],
        ['notification', `${NOTIFICATION_URL}/health`],
    ];
    for (const [name, url] of services) {
        const r = http.get(url);
        check(r, { [`${name} health 200`]: (res) => res.status === 200 });
    }
}

export default function () {
    let token = '';
    let userId = '';

    group('Frontend (nginx)', function () {
        const res = http.get(`${BASE_URL}/`);
        check(res, { 'frontend 200': (r) => r.status === 200 });

        // Exercise nginx -> catalogue reverse proxy path
        const proxied = http.get(`${BASE_URL}/api/catalogue/products`);
        check(proxied, { 'nginx -> catalogue 200': (r) => r.status === 200 });
    });

    group('Browse Catalogue', function () {
        let res = http.get(`${CATALOGUE_URL}/products`);
        check(res, { 'catalogue 200': (r) => r.status === 200 });

        res = http.get(`${CATALOGUE_URL}/categories`);
        check(res, {
            'categories 200': (r) => r.status === 200,
            'categories is array': (r) => Array.isArray(r.json()),
        });

        // Pick a real category from the catalogue rather than guessing
        let category = '';
        try { category = res.json()[0] || ''; } catch (e) { /* ignore */ }
        if (category) {
            const filtered = http.get(`${CATALOGUE_URL}/products?category=${encodeURIComponent(category)}`);
            check(filtered, { 'category filter 200': (r) => r.status === 200 });
        }

        res = http.get(`${CATALOGUE_URL}/products/search?q=robot`);
        check(res, { 'search 200': (r) => r.status === 200 });

        // Missing 'q' must be a 400, not a 500
        const badSearch = http.get(`${CATALOGUE_URL}/products/search`);
        check(badSearch, { 'search no-q 400': (r) => r.status === 400 });
    });

    group('View Product', function () {
        let res = http.get(`${CATALOGUE_URL}/products/1`);
        check(res, { 'product 200': (r) => r.status === 200 });

        // 404 path
        const missing = http.get(`${CATALOGUE_URL}/products/999999`);
        check(missing, { 'product 404': (r) => r.status === 404 });
    });

    group('Register & Login', function () {
        let uname = USERNAME + '_' + __ITER;
        const reg = http.post(`${USER_URL}/register`, JSON.stringify({
            username: uname,
            email: uname + '@test.com',
            password: PASSWORD,
            firstName: 'Load',
            lastName: 'Test',
        }), JSON_HEADERS);
        check(reg, { 'register 201': (r) => r.status === 201 });

        // Duplicate registration must 400
        const dup = http.post(`${USER_URL}/register`, JSON.stringify({
            username: uname,
            email: uname + '@test.com',
            password: PASSWORD,
        }), JSON_HEADERS);
        check(dup, { 'register duplicate 400': (r) => r.status === 400 });

        let loginRes = http.post(`${USER_URL}/login`, JSON.stringify({
            username: uname,
            password: PASSWORD,
        }), JSON_HEADERS);
        check(loginRes, {
            'login 200': (r) => r.status === 200,
            'login has token': (r) => !!r.json('token'),
        });

        if (loginRes.status === 200) {
            let body = loginRes.json();
            token = body.token;
            userId = body.user.id;
        }

        // Bad credentials must 401
        const badLogin = http.post(`${USER_URL}/login`, JSON.stringify({
            username: uname,
            password: 'wrong',
        }), JSON_HEADERS);
        check(badLogin, { 'login bad creds 401': (r) => r.status === 401 });
    });

    if (userId) {
        group('User Profile & Validate', function () {
            // /profile requires the JWT we just got
            const profile = http.get(`${USER_URL}/profile`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            check(profile, { 'profile 200': (r) => r.status === 200 });

            // Missing token must 401
            const noAuth = http.get(`${USER_URL}/profile`);
            check(noAuth, { 'profile no-auth 401': (r) => r.status === 401 });

            // Internal validate endpoint used by payment service
            const validate = http.get(`${USER_URL}/validate/${userId}`);
            check(validate, { 'validate 200': (r) => r.status === 200 });
        });

        group('Shipping', function () {
            const cities = http.get(`${SHIPPING_URL}/shipping/cities`);
            check(cities, {
                'cities 200': (r) => r.status === 200,
                'cities non-empty': (r) => Array.isArray(r.json()) && r.json().length > 0,
            });

            // Use a real city id from the list if available, else fall back
            let cityId = 1;
            try {
                const list = cities.json();
                if (list && list.length) cityId = list[Math.floor(Math.random() * list.length)].id;
            } catch (e) { /* ignore */ }

            const calc = http.get(`${SHIPPING_URL}/shipping/calc?cityId=${cityId}`);
            check(calc, {
                'shipping calc 200': (r) => r.status === 200,
                'shipping cost present': (r) => r.json('shippingCost') !== undefined,
            });
        });

        const productId = Math.floor(Math.random() * 12) + 1;

        group('Add to Cart', function () {
            let res = http.post(`${CART_URL}/cart/${userId}/add`, JSON.stringify({
                productId: productId,
                quantity: 1,
            }), JSON_HEADERS);
            check(res, { 'add cart 200': (r) => r.status === 200 });
        });

        group('View Cart', function () {
            let res = http.get(`${CART_URL}/cart/${userId}`);
            check(res, {
                'view cart 200': (r) => r.status === 200,
                'cart has items': (r) => (r.json('items') || []).length > 0,
            });
        });

        group('Update Cart Quantity', function () {
            const res = http.put(`${CART_URL}/cart/${userId}/update`, JSON.stringify({
                productId: productId,
                quantity: 3,
            }), JSON_HEADERS);
            check(res, { 'update cart 200': (r) => r.status === 200 });
        });

        group('Remove Cart Item', function () {
            // Add a second item so we can remove it without emptying the cart
            const extraId = (productId % 12) + 1;
            http.post(`${CART_URL}/cart/${userId}/add`, JSON.stringify({
                productId: extraId,
                quantity: 1,
            }), JSON_HEADERS);
            const res = http.del(`${CART_URL}/cart/${userId}/item/${extraId}`);
            check(res, { 'remove cart item 200': (r) => r.status === 200 });
        });

        group('Checkout', function () {
            let res = http.post(`${PAYMENT_URL}/payment/process`, JSON.stringify({
                userId: userId,
                cityId: Math.floor(Math.random() * 25) + 1,
            }), JSON_HEADERS);
            check(res, {
                'payment 200': (r) => r.status === 200,
                'payment has txn id': (r) => !!r.json('transactionId'),
            });
        });

        group('Empty Cart Checkout Rejected', function () {
            // Cart was cleared by previous checkout; second attempt must 400
            const res = http.post(`${PAYMENT_URL}/payment/process`, JSON.stringify({
                userId: userId,
                cityId: 1,
            }), JSON_HEADERS);
            check(res, { 'empty cart checkout 400': (r) => r.status === 400 });
        });

        group('Orders', function () {
            // The orders service consumes from RabbitMQ asynchronously, so the
            // order may not exist immediately. Give it a brief window before
            // asserting reachability.
            sleep(1);

            const userOrders = http.get(`${ORDERS_URL}/orders/user/${userId}`);
            check(userOrders, {
                'user orders 200': (r) => r.status === 200,
                'user orders is array': (r) => Array.isArray(r.json()),
            });

            // Direct create path (used in tests / admin flows)
            const created = http.post(`${ORDERS_URL}/orders`, JSON.stringify({
                userId: userId,
                items: [{ productId: productId, name: 'load-test', price: 1.0, quantity: 1 }],
                total: 1.0,
                status: 'PAID',
            }), JSON_HEADERS);
            check(created, {
                'create order 200': (r) => r.status === 200,
                'create order has id': (r) => !!r.json('id'),
            });

            if (created.status === 200) {
                const id = created.json('id');
                const fetched = http.get(`${ORDERS_URL}/orders/${id}`);
                check(fetched, { 'get order by id 200': (r) => r.status === 200 });
            }

            const notFound = http.get(`${ORDERS_URL}/orders/000000000000000000000000`);
            check(notFound, { 'get order 404': (r) => r.status === 404 });
        });

        group('Notification', function () {
            const res = http.post(`${NOTIFICATION_URL}/notification/send`, JSON.stringify({
                orderId: 'LOAD-TEST',
                email: USERNAME + '@test.com',
                name: 'Load Test',
                total: 42.0,
            }), JSON_HEADERS);
            check(res, { 'notification 200': (r) => r.status === 200 });
        });

        group('Rate Product', function () {
            const ratingProduct = Math.floor(Math.random() * 12) + 1;
            let res = http.post(`${RATINGS_URL}/ratings`, JSON.stringify({
                productId: ratingProduct,
                userId: userId,
                score: Math.floor(Math.random() * 5) + 1,
                review: 'Load test review',
            }), JSON_HEADERS);
            check(res, { 'rating 200': (r) => r.status === 200 });

            // Out-of-range score must 400
            const bad = http.post(`${RATINGS_URL}/ratings`, JSON.stringify({
                productId: ratingProduct,
                userId: userId,
                score: 99,
            }), JSON_HEADERS);
            check(bad, { 'rating bad score 400': (r) => r.status === 400 });

            const list = http.get(`${RATINGS_URL}/ratings/product/${ratingProduct}`);
            check(list, {
                'ratings list 200': (r) => r.status === 200,
                'ratings list is array': (r) => Array.isArray(r.json()),
            });

            const avg = http.get(`${RATINGS_URL}/ratings/product/${ratingProduct}/average`);
            check(avg, {
                'ratings avg 200': (r) => r.status === 200,
                'ratings avg has fields': (r) => r.json('average') !== undefined && r.json('count') !== undefined,
            });
        });

        group('Clear Cart', function () {
            // Make sure DELETE /cart/:userId is exercised even after checkout
            http.post(`${CART_URL}/cart/${userId}/add`, JSON.stringify({
                productId: productId,
                quantity: 1,
            }), JSON_HEADERS);
            const res = http.del(`${CART_URL}/cart/${userId}`);
            check(res, { 'clear cart 200': (r) => r.status === 200 });
        });
    }

    sleep(1);
}
