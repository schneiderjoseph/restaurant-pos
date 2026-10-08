import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {reloadForUpdate, subscribeClientUpdate} from '@/lib/client-update.ts'

export function ClientUpdateBanner() {
  const {t} = useTranslation(['common'])
  const [pending, setPending] = useState(false)

  useEffect(() => subscribeClientUpdate(setPending), [])

  if (!pending) return null

  return (
    <button
      type="button"
      className="fixed top-0 left-0 right-0 z-[10000] bg-primary-600 text-white text-center py-2 text-sm font-medium shadow-md"
      data-testid="client-update-banner"
      onClick={() => reloadForUpdate()}
    >
      {t('common:update.available', {
        defaultValue: 'Update available — tap to reload',
      })}
    </button>
  )
}
