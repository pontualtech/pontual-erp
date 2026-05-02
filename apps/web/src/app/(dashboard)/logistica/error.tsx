'use client'

import { ModuleError } from '../components/module-error'

export default function LogisticaError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ModuleError {...props} moduleName="Logística" />
}
