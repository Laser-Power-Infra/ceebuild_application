import type { LucideIcon } from 'lucide-react';
import {
  Building,
  Calculator,
  Cog,
  Library,
  Factory,
  FileSpreadsheet,
  FileText,
  Gauge,
  History,
  IndianRupee,
  Layers,
  Package,
  PackageCheck,
  Ruler,
  Settings2,
  Sliders,
  Truck,
  Wrench,
} from 'lucide-react';

/** Tabs of the quotation dashboard at `/` (switched in place, `?tab=`). */
export type QuotationTab = 'dockets' | 'terms' | 'logs' | 'master';

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Set for quotation-dashboard tabs: they switch without a page load when already on `/`. */
  tab?: QuotationTab;
  /** Only these roles see the entry. Omit for everyone. */
  roles?: string[];
  /** Planned screen: shown greyed out with a "Soon" tag and not clickable. */
  soon?: boolean;
  /** Extra paths that should also mark this entry active. */
  match?: string[];
};

export type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

/**
 * The app's whole navigation, in business-process order. To add a screen, add one entry to the
 * right group (or a new group); the sidebar, mobile drawer and collapsed rail all pick it up.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    items: [{ key: 'overview', label: 'Control Tower', icon: Gauge, href: '/overview' }],
  },
  {
    key: 'quotation',
    label: 'Quotation',
    items: [
      { key: 'dockets', label: 'Dockets', icon: Building, href: '/?tab=dockets', tab: 'dockets' },
      { key: 'terms', label: 'Terms & Conditions', icon: FileText, href: '/?tab=terms', tab: 'terms' },
    ],
  },
  {
    key: 'planning',
    label: 'Orders & Planning',
    items: [
      { key: 'orders', label: 'Orders', icon: Package, href: '/orders' },
      { key: 'rm-indent', label: 'RM Indent', icon: Ruler, href: '/planning/indent' },
      { key: 'rm-receipt', label: 'RM Receipt & Re-plan', icon: PackageCheck, href: '/planning/receipt' },
      { key: 'production-plan', label: 'Machine Plan', icon: Cog, href: '/planning/production' },
    ],
  },
  {
    key: 'execution',
    label: 'Execution',
    items: [
      { key: 'production', label: 'Daily Production', icon: Factory, href: '/production' },
      { key: 'execution', label: 'Inspection & Dispatch', icon: Truck, href: '/execution' },
    ],
  },
  {
    key: 'finance',
    label: 'Billing',
    items: [{ key: 'billing', label: 'Billing & Collection', icon: IndianRupee, href: '/billing' }],
  },
  {
    key: 'admin',
    label: 'Administration',
    items: [
      { key: 'costing-master', label: 'Costing Master', icon: Calculator, href: '/admin/costing' },
      { key: 'drawings', label: 'Approved Drawings', icon: Library, href: '/admin/drawings' },
      { key: 'sections', label: 'GTP Sections', icon: Layers, href: '/admin/sections' },
      { key: 'machines', label: 'Machines', icon: Wrench, href: '/admin/machines' },
      { key: 'plan-settings', label: 'Planning Settings', icon: Settings2, href: '/admin/planning' },
      { key: 'master', label: 'Master Dropdowns', icon: Sliders, href: '/?tab=master', tab: 'master', roles: ['Admin'] },
      { key: 'logs', label: 'Audit Log', icon: History, href: '/?tab=logs', tab: 'logs' },
    ],
  },
];

