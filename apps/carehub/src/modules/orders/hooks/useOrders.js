import { useState, useEffect, useCallback } from 'react'
import { orderRepository, territoryRepository, locationRepository } from '../repositories'
import { useToast } from '../../../components/ui'

export function useOrders(businessId) {
  const toast = useToast()
  const [orders, setOrders] = useState([])
  const [itemsByOrder, setItemsByOrder] = useState({})
  const [watchersByOrder, setWatchersByOrder] = useState({})
  const [filesByOrder, setFilesByOrder] = useState({})
  const [eventsByOrder, setEventsByOrder] = useState({})
  const [staffList, setStaffList] = useState([])
  const [products, setProducts] = useState([])
  const [territories, setTerritories] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStage, setFilterStage] = useState('all')

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const [o, s, p, t, l] = await Promise.all([
        orderRepository.getAll(businessId),
        // getStaff would come from staff repository
        [], // staffList - would be loaded from staff repository
        [], // products - would be loaded from product repository
        territoryRepository.getAll(businessId),
        locationRepository.getAll(businessId),
      ])
      setOrders(o || [])
      setTerritories(t || [])
      setLocations(l || [])
    } catch (e) {
      console.error('Load orders error:', e)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { load() }, [load])

  const createOrder = async (orderData) => {
    const newOrder = await orderRepository.create(businessId, orderData)
    setOrders(prev => [newOrder, ...prev])
    return newOrder
  }

  const advanceOrder = async (orderId, stage, note, actorId) => {
    await orderRepository.advance(orderId, businessId, stage, note, actorId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, stage } : o))
  }

  const loadOrderItems = async (orderId) => {
    if (itemsByOrder[orderId]) return
    const items = await orderRepository.getItems(orderId)
    setItemsByOrder(prev => ({ ...prev, [orderId]: items }))
  }

  const loadOrderWatchers = async (orderId) => {
    if (watchersByOrder[orderId]) return
    const watchers = await orderRepository.getWatchers(orderId)
    setWatchersByOrder(prev => ({ ...prev, [orderId]: watchers }))
  }

  const loadOrderFiles = async (orderId) => {
    if (filesByOrder[orderId]) return
    const files = await orderRepository.getFiles(orderId)
    setFilesByOrder(prev => ({ ...prev, [orderId]: files }))
  }

  const loadOrderEvents = async (orderId) => {
    if (eventsByOrder[orderId]) return
    const events = await orderRepository.getEvents(orderId)
    setEventsByOrder(prev => ({ ...prev, [orderId]: events }))
  }

  const PIPELINE = ['submitted', 'approved', 'processing', 'dispatched', 'delivered']

  return {
    orders,
    itemsByOrder,
    watchersByOrder,
    filesByOrder,
    eventsByOrder,
    staffList,
    products,
    territories,
    locations,
    loading,
    filterStage,
    setFilterStage,
    load,
    createOrder,
    advanceOrder,
    loadOrderItems,
    loadOrderWatchers,
    loadOrderFiles,
    loadOrderEvents,
    PIPELINE,
    STAGE_LABEL: {
      submitted: 'Awaiting Approval',
      approved: 'Approved',
      processing: 'Warehouse Processing',
      dispatched: 'Dispatched',
      delivered: 'Delivered',
      rejected: 'Rejected',
    },
  }
}