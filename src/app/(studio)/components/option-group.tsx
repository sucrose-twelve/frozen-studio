"use client"

import { ToggleButton, ToggleButtonGroup } from "@heroui/react"
import { useCallback, useMemo } from "react"

import { cls } from "@/libs/utils"

export type Option<T extends string | number> = {
  value: T
  label: React.ReactNode
  isDisabled?: boolean
}

/**
 * A row of buttons where exactly one is chosen: quality, size, length. A typed front for HeroUI's
 * `ToggleButtonGroup`, whose keys are strings, so the option's own value comes back out.
 */
export function OptionGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
  isDisabled
}: Readonly<{
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  className?: string
  isDisabled?: boolean
}>) {
  const selectedKeys = useMemo(() => [String(value)], [value])

  const handleSelectionChange = useCallback(
    (keys: Set<string | number>) => {
      const [key] = keys
      const option = options.find((item) => String(item.value) === String(key))
      if (option) onChange(option.value)
    },
    [options, onChange]
  )

  return (
    <ToggleButtonGroup
      aria-label={label}
      className={cls("w-full", className)}
      selectionMode='single'
      size='sm'
      fullWidth
      isDetached
      disallowEmptySelection
      isDisabled={isDisabled}
      selectedKeys={selectedKeys}
      onSelectionChange={handleSelectionChange}>
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          id={String(option.value)}
          isDisabled={option.isDisabled}
          className='min-w-0 flex-1 px-2'>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
