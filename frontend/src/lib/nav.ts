import { Bell, Boxes, BrainCircuit, Building2, ClipboardCheck, Factory, FileScan, FileText, FlaskConical, Gauge, History, LineChart, PackageCheck, ScrollText, Search, ShieldCheck, ShoppingCart, Timer, Truck, Users, Warehouse, Layers, BarChart3, Beaker } from 'lucide-react';

export interface NavItem { href: string; label: string; icon: any; perm: string }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { title: 'Overview', items: [
    { href: '/dashboard', label: 'Dashboard', icon: Gauge, perm: 'dashboard:read' },
    { href: '/notifications', label: 'Notifications', icon: Bell, perm: 'notification:read' },
  ] },
  { title: 'Materials & purchasing', items: [
    { href: '/raw-materials', label: 'Raw materials', icon: Boxes, perm: 'material:read' },
    { href: '/inventory', label: 'Stock & lots', icon: Layers, perm: 'stock:read' },
    { href: '/suppliers', label: 'Suppliers', icon: Building2, perm: 'supplier:read' },
    { href: '/purchase', label: 'Purchasing', icon: ShoppingCart, perm: 'purchase:read' },
    { href: '/warehouses', label: 'Warehouses', icon: Warehouse, perm: 'warehouse:read' },
  ] },
  { title: 'Manufacturing', items: [
    { href: '/formulas', label: 'Formulas & BOM', icon: Beaker, perm: 'formula:read' },
    { href: '/batches', label: 'Batch records', icon: ClipboardCheck, perm: 'batch:read' },
    { href: '/production', label: 'Production', icon: Factory, perm: 'production:read' },
    { href: '/finished-goods', label: 'Finished goods', icon: PackageCheck, perm: 'fg:read' },
  ] },
  { title: 'Quality & compliance', items: [
    { href: '/qc', label: 'Quality control', icon: FlaskConical, perm: 'qc:read' },
    { href: '/expiry', label: 'Expiry & recalls', icon: Timer, perm: 'expiry:read' },
    { href: '/documents', label: 'Documents', icon: FileText, perm: 'document:read' },
    { href: '/audit', label: 'Audit trail', icon: History, perm: 'audit:read' },
  ] },
  { title: 'Intelligence', items: [
    { href: '/ai/documents', label: 'Document AI', icon: FileScan, perm: 'ai:read' },
    { href: '/ai/search', label: 'Ask the system', icon: Search, perm: 'ai:search' },
    { href: '/analytics', label: 'Forecasts', icon: LineChart, perm: 'analytics:read' },
    { href: '/reports', label: 'Reports', icon: BarChart3, perm: 'report:read' },
  ] },
  { title: 'Administration', items: [{ href: '/users', label: 'Users & roles', icon: Users, perm: 'user:read' }] },
];
export { BrainCircuit, ScrollText, ShieldCheck, Truck };
