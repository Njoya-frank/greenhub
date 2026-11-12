# Greenhub

A self-contained responsive product storefront inspired by the visual direction of the supplied reference site. It uses plain HTML, CSS, and JavaScript so it can be previewed without a build step.

## Preview

From this folder, run:

```bash
npm start
```

Then open `http://localhost:4173` (do not double-click the HTML files or open them with a `file://` URL).

The page includes responsive navigation, product filtering, search, sorting, wishlist toggles, a shopping bag drawer, and a newsletter interaction. Product and brand copy are original placeholders ready to be replaced with real catalog data.

The demo checkout supports Bitcoin, Greenhub gift cards, and Revolut Bank transfers.

Payment selection and gift-card redemption are frontend demo flows. Connect a provider such as Stripe, Adyen, or Mollie plus a server-side order endpoint before accepting real payments.

## Deploy to Vercel

This is a static site on Vercel. The included `vercel.json` builds the browser files into `dist/`; Vercel serves that directory and does not invoke the local-only `scripts/server.js` as a Vercel Function.

To give Vercel full control of deployments, import this repository into Vercel and connect the production branch. Every push to that branch will trigger a new Vercel deployment. Use the repository root as the **Root Directory** and choose **Other** as the framework preset. The committed `vercel.json` already sets `npm run build` as the **Build Command** and `dist` as the **Output Directory**. Do not set `npm start` as the Vercel build command; that command is only for local development.

You do not need to install or run a separate server in production. The local commands are:

```bash
npm run build   # verify the Vercel output locally
npm start       # preview the site locally at http://localhost:4173
```

The public storefront can load without Supabase, but the catalogue, checkout order creation, and admin portal need these Production environment variables in Vercel:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
SUPABASE_AUTH_REDIRECT_TO=https://YOUR_VERCEL_DOMAIN/admin.html
```

After an order is saved, the storefront sends the order ID, customer details, product names, quantities, total, and payment method into the customer's Smartsupp chat. The order message appears in the Smartsupp Inbox and the checkout opens the chat so the customer can continue there. No Resend key is needed for this chat notification.

The values in `.env` and `.env.local` are intentionally ignored by Git and are not uploaded to Vercel. Keep Smartsupp credentials in the supplied storefront script and do not add private API tokens to browser code.

## Supabase setup

The admin console uses Supabase Auth and only allows users whose profile role is `admin`.

1. Create a Supabase project and run the complete `supabase/schema.sql` in the Supabase Dashboard SQL Editor or a PostgreSQL owner connection. Do not send this file through an API key: `anon`/`authenticated` roles cannot create schemas, types, triggers, or policies. It creates the tables, RLS policies, product image metadata columns, and the public `greenhub` Storage bucket. If you already ran an older version, run the updated file so its `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` repairs existing tables.
2. Open `admin.html` and use **Sign up** to create an account, or create the first user in Supabase Authentication → Users. New signups start as `customer` for safety. The signup trigger also stores the member email in `profiles` so an administrator can manage access from the Team screen.
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

After the first admin can sign in, open **Team & admins** in the console. New members appear there as `Member`; use **Grant admin** to give a trusted account console access, or **Revoke admin** to remove it. The database function prevents the current admin from revoking their own access and keeps at least one administrator. If signup returns HTTP 500 / `Database error saving new user`, run `supabase/admin-management.sql` once in the Supabase SQL Editor as the database owner to repair the profile trigger and apply the role-management migration.

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

The storefront uses Smartsupp Live Chat with the configured website key. Customers can open the Smartsupp widget from the provider's floating launcher or the **Chat with us** links in the footer. Open **Smartsupp** in the admin console to go to Smartsupp and manage conversations, automations, and connected channels.

## Admin console

Open `http://localhost:4173/admin.html` to manage products, upload product and storefront images, review orders and customers, manage team roles, change order status, update storefront messaging, and open Smartsupp live chat management. Product categories are configured under **Store content** and are used by the product form, storefront category cards, and filters. Product, content, order, customer, team, newsletter, and image data load from Supabase; the storefront does not silently replace a missing catalogue with mock products.
