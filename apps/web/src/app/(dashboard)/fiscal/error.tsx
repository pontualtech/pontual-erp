'use client'

import { ModuleError } from '../components/module-error'

export default function FiscalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ModuleError {...props} moduleName="Fiscal" />
}
