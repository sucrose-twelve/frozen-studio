"use client"

import { Description, Separator, Switch } from "@heroui/react"

import { cls } from "@/libs/utils"

/**
 * A titled block of a studio form, with an optional note on the right of the title.
 */
export function FormSection({
  title,
  note,
  children,
  className
}: Readonly<{
  title: string
  note?: React.ReactNode
  children: React.ReactNode
  className?: string
}>) {
  return (
    <section className={cls("flex flex-col gap-2.5", className)}>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='text-foreground text-sm font-semibold'>{title}</h3>
        {note ? <span className='text-muted truncate text-xs'>{note}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * The thick rule between two zones of a form: the everyday settings above, the advanced ones below.
 */
export function FormDivider() {
  return <Separator className='h-0.5' />
}

/**
 * A labelled sub-row inside a section, e.g. "Aspect" above its buttons.
 */
export function FieldRow({
  label,
  children
}: Readonly<{
  label: string
  children: React.ReactNode
}>) {
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='text-muted text-xs font-medium'>{label}</span>
      {children}
    </div>
  )
}

/**
 * An on/off setting with a one-line explanation.
 */
export function SwitchField({
  label,
  description,
  isSelected,
  isDisabled,
  onChange
}: Readonly<{
  label: string
  description: string
  isSelected: boolean
  isDisabled?: boolean
  onChange: (isSelected: boolean) => void
}>) {
  return (
    <Switch size='sm' isSelected={isSelected} isDisabled={isDisabled} onChange={onChange}>
      <Switch.Content className='text-sm'>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
      <Description className='text-xs'>{description}</Description>
    </Switch>
  )
}

/**
 * A validation message under a field. Renders nothing without a message.
 */
export function FieldMessage({ message }: Readonly<{ message?: string }>) {
  if (!message) return null

  return (
    <p role='alert' className='text-danger text-xs'>
      {message}
    </p>
  )
}
