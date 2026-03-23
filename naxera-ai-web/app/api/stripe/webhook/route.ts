import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  const body = await request.text();
  const headerList = await headers();
  const sig = headerList.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error('Webhook Error:', err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const userId = session.client_reference_id;
    const customerId = session.customer as string;

    if (!userId) {
      console.error('Missing userId in session metadata');
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Retrieve the subscription to know what plan was purchased
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'subscription'],
    });

    const lineItems = fullSession.line_items?.data;
    if (!lineItems || lineItems.length === 0) {
        console.error('No line items found');
        return NextResponse.json({ error: 'No line items' }, { status: 400 });
    }

    const priceId = lineItems[0].price?.id;
    let plan: 'core' | 'pro' = 'core';

    if (priceId === process.env.STRIPE_PRO_PRICE_ID) {
      plan = 'pro';
    } else if (priceId === process.env.STRIPE_CORE_PRICE_ID) {
      plan = 'core';
    }

    // Upsert the profile in Supabase to create it if it doesn't exist yet
    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert({ 
        id: userId,
        plan: plan,
        stripe_customer_id: customerId
      });

    if (error) {
      console.error('Supabase Update Error:', error);
      return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
    }

    console.log(`Successfully upgraded user ${userId} to ${plan} plan`);
  }

  return NextResponse.json({ received: true });
}
