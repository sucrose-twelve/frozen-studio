"use client"

import { ToggleButton, ToggleButtonGroup } from "@heroui/react"
import type { IconProps } from "@keyline-icons/react"
import { useCallback, useMemo } from "react"

import { cls } from "@/libs/utils"

type SwitchIcon = (props: IconProps) => React.ReactNode

export type KindItem<T extends string> = {
  id: T
  label: string
  Icon: SwitchIcon
}

/**
 * An on/off setting that sits with the tool as an icon, and is not one of the kinds: turning it on leaves
 * the chosen kind as it is.
 */
export type KindToggle = {
  id: string
  label: string
  Icon: SwitchIcon
  isSelected: boolean
  onChange: (isSelected: boolean) => void
}

const NO_TOGGLES: readonly KindToggle[] = []

/**
 * The switch between kinds of media that the studio and the gallery share: the kinds that are made, by
 * name, and one tool that stands apart from them as an icon (Cutout works on images that already exist).
 *
 * It is two groups with one choice of kind between them: the named group shows it when it is one of its
 * own, the icon group when it is the tool, so choosing in one clears the other. The icon group can also
 * hold toggles, which are on or off beside that choice (the gallery's Favorites).
 *
 * @param label - Names the switch for screen readers, e.g. "Mode"
 * @param items - The named kinds, in order
 * @param tool - The kind shown as an icon only; its label is read out instead
 * @param toggles - On/off settings shown as icons after the tool
 */
export function KindSwitch<T extends string>({
  label,
  items,
  tool,
  toggles = NO_TOGGLES,
  value,
  onChange,
  className
}: Readonly<{
  label: string
  items: readonly KindItem<T>[]
  tool: KindItem<T>
  toggles?: readonly KindToggle[]
  value: T
  onChange: (value: T) => void
  className?: string
}>) {
  const kindKeys = useMemo(() => [value], [value])
  const iconKeys = useMemo(
    () => [
      ...(value === tool.id ? [tool.id] : []),
      ...toggles.filter((toggle) => toggle.isSelected).map((toggle) => toggle.id)
    ],
    [value, tool, toggles]
  )

  const handleKindChange = useCallback(
    (keys: Set<string | number>) => {
      const [key] = keys
      const next = items.find((item) => item.id === key)
      if (next) onChange(next.id)
    },
    [items, onChange]
  )

  // The tool can be chosen here but not un-chosen: a kind is always showing. The toggles go both ways
  const handleIconChange = useCallback(
    (keys: Set<string | number>) => {
      if (keys.has(tool.id) && value !== tool.id) onChange(tool.id)
      for (const toggle of toggles) {
        const isSelected = keys.has(toggle.id)
        if (isSelected !== toggle.isSelected) toggle.onChange(isSelected)
      }
    },
    [tool, toggles, value, onChange]
  )

  return (
    <div className={cls("flex gap-x-2", className)}>
      <ToggleButtonGroup
        aria-label={label}
        selectionMode='single'
        fullWidth
        disallowEmptySelection
        className='min-w-0 flex-1'
        selectedKeys={kindKeys}
        onSelectionChange={handleKindChange}>
        {items.map(({ id, label: name, Icon }, index) => (
          <ToggleButton key={id} id={id} className='min-w-0 flex-1 px-2'>
            {index > 0 ? <ToggleButtonGroup.Separator /> : null}
            <Icon size={17} strokeWidth={1.75} />
            {name}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButtonGroup
        aria-label={[tool, ...toggles].map((item) => item.label).join(" and ")}
        selectionMode='multiple'
        className='shrink-0'
        selectedKeys={iconKeys}
        onSelectionChange={handleIconChange}>
        {[tool, ...toggles].map(({ id, label: name, Icon }, index) => (
          <ToggleButton key={id} id={id} isIconOnly aria-label={name}>
            {index > 0 ? <ToggleButtonGroup.Separator /> : null}
            <Icon size={17} strokeWidth={1.75} />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  )
}
