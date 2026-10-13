import { useEffect, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { useAdminShopData } from '../../../hooks/queries'
import ShopTab from '../tabs/ShopTab.jsx'
import EmailTemplatesTab from '../tabs/EmailTemplatesTab.jsx'

// The screens that have not been redesigned yet. They still receive the state
// and handlers they were written against; each redesign phase moves a tab's
// state into its own section file and deletes its share of this file.
// Session, toasts, confirm and sign-out come from AdminProvider.

export default function LegacyTabHost({ tab, setTab }) {
  const { adminUser, permissions: adminPermissions, showToast, askConfirm, invalidateAdmin } = useAdmin()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: shopData } = useAdminShopData(!!adminUser)

  const ecomApps = shopData?.apps || []
  const ecomProductsAdmin = shopData?.products || []
  const shopOrdersAdmin = shopData?.orders || []

  async function updateEcomApp(id, status) {
    try {
      await callAdminAuth('update_ecommerce_application', {  id, status })
      showToast(`Application ${status}`, { type: 'success' }); invalidateAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }
  async function moderateProduct(id, patch) {
    try {
      await callAdminAuth('moderate_ecommerce_product', {  id, ...patch })
      showToast('Product updated', { type: 'success' }); invalidateAdmin()
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }

  return (
    <div>
      {tab === 'shop' && <ShopTab showToast={showToast} />}
      {tab === 'email_templates' && <EmailTemplatesTab showToast={showToast} />}
    </div>
  )
}
