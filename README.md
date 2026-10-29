# Greenhub Parts

A self-contained responsive spare-parts storefront inspired by the visual direction of the supplied reference site. It uses plain HTML, CSS, and JavaScript so it can be previewed without a build step.

## Preview

From this folder, run:

```bash
npm start
```

Then open `http://localhost:4173` (do not double-click the HTML files or open them with a `file://` URL).

The page includes responsive navigation, product filtering, search, sorting, wishlist toggles, a shopping bag drawer, and a newsletter interaction. Product and brand copy are original placeholders ready to be replaced with real catalog data.

The demo checkout also includes European payment choices: cards, PayPal, Apple Pay, Google Pay, Klarna, SEPA Direct Debit, iDEAL, Bancontact, Sofort, and Greenhub gift cards.

Payment selection and gift-card redemption are frontend demo flows. Connect a provider such as Stripe, Adyen, or Mollie plus a server-side order endpoint before accepting real payments.

## Supabase setup

The admin console uses Supabase Auth and only allows users whose profile role is `admin`.

1. Create a Supabase project and run the complete `supabase/schema.sql` in the Supabase Dashboard SQL Editor or a PostgreSQL owner connection. Do not send this file through an API key: `anon`/`authenticated` roles cannot create schemas, types, triggers, or policies. It creates the tables, RLS policies, product image metadata columns, and the public `greenhub` Storage bucket. If you already ran an older version, run the updated file so its `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` repairs existing tables.
2. Open `admin.html` and use **Sign up** to create an account, or create the first user in Supabase Authentication → Users. New signups start as `customer` for safety.
3. Promote that user with the user UUID. Run this in the Supabase Dashboard SQL Editor (or a PostgreSQL connection as the database owner), not through `supabase-js` or the browser:

```sql
update public.profiles
set role = 'admin'
where id = 'USER_UUID';

insert into public.profiles (id, role)
select 'USER_UUID', 'admin'
where not exists (select 1 from public.profiles where id = 'USER_UUID');
```

You can copy the UUID from Authentication → Users. The `authenticated` API role cannot read `auth.users` or change admin roles, so a `permission denied for table users` error means this statement was sent through the client instead of an owner SQL connection.

4. Store the values in `.env.local` or `.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
# Optional; add the same URL to Supabase Auth's Redirect URLs.
SUPABASE_AUTH_REDIRECT_TO=https://YOUR_SITE.example/admin.html
```

`SUPABASE_URL` must be the project URL, such as `https://YOUR_PROJECT.supabase.co`; do not append `/rest/v1`. The loader also removes that suffix automatically if it is present.

`.env.local` takes precedence over `.env`. Run `npm start`; the included server reads those files and serves only the public Supabase URL, anon key, and optional redirect URL to the browser at `/supabase-config.js`.

For a static deployment, provide the same values through that host's public environment/build configuration. The browser cannot read `.env` files directly.

The equivalent static config is:

```js
window.GREENHUB_SUPABASE_CONFIG = Object.freeze({
  url: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_PUBLIC_ANON_KEY',
  authRedirectTo: 'https://YOUR_SITE.example/admin.html'
});
```

Never put a Supabase service-role key in browser files. The server rejects a key whose JWT role is `service_role` or `supabase_admin`; replace it with the project’s public anon/publishable key in `.env.local`. The RLS policies in `supabase/schema.sql` keep catalogue and management operations restricted to approved admins while allowing public checkout order creation and newsletter subscriptions. All images uploaded from the admin console are stored in the `greenhub` bucket: product images use `products/<product-id>/...`, while customer-facing hero, story, and category images use `storefront/<field>/...`.

The storefront support widget uses the `support_presence`, `support_conversations`, and `support_messages` tables created by the schema. In the admin console, open **Support** and switch availability on when you are ready to answer customers. When it is off, the widget stores the customer conversation and replies with the built-in assistant; when it is on, new messages appear in the admin inbox and replies are delivered back to the same customer chat.

## Admin console

Open `http://localhost:4173/admin.html` to manage products, upload product and storefront images, review orders and customers, change order status, update storefront messaging, and answer support conversations. Product, content, order, customer, support, newsletter, and image data load from Supabase; the storefront does not silently replace a missing catalogue with mock products.
