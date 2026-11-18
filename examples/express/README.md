# Express example

```bash
cp ../../.env.example .env   # add KHALTI_SECRET_KEY to try Khalti; eSewa works with no keys in sandbox
npm install
npm start
```

Start a payment with a form that POSTs to `/checkout/esewa` or `/checkout/khalti`, e.g.:

```bash
open http://localhost:3000   # or: curl -X POST http://localhost:3000/checkout/esewa
```

Pay with the sandbox test accounts listed in the main README.
