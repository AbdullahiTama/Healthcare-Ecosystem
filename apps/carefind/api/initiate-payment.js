export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, amount, ref, callback_url } = req.body

  if (!email || !amount || !ref || !callback_url) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount,
        reference: ref,
        callback_url,
        currency: 'NGN',
      }),
    })

    const data = await response.json()

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Paystack error' })
    }

    return res.status(200).json({ authorization_url: data.data.authorization_url })
  } catch (err) {
    return res.status(500).json({ error: 'Server error' })
  }
}
