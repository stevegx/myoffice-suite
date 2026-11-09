import { createElement, lazy } from 'react'

const SystemStatus = lazy(() => import('./system-status/SystemStatus'))
const Payments = lazy(() => import('./payments/Payments'))
const Repricing = lazy(() => import('./repricing/Repricing'))
const Products = lazy(() => import('./products/Products'))
const Converter = lazy(() => import('./converter/Converter'))

export const toolViews = new Map([
  ['system-status', createElement(SystemStatus)],
  ['payments', createElement(Payments)],
  ['repricing', createElement(Repricing)],
  ['products', createElement(Products)],
  ['converter', createElement(Converter)],
])
