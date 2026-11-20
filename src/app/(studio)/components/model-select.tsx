"use client"

import { ListBox, Select } from "@heroui/react"
import { useCallback } from "react"

import { FormSection } from "./form-parts"

export type ModelOption = {
  id: string
  label: string
}

/**
 * The model a form's jobs run on: the first thing in the form, since everything under it is that model's
 * settings.
 *
 * It is there with a single model too, to say which one is in use, and without any it stays on screen,
 * disabled; the form's submit bar says what is missing.
 *
 * A model that works in several files gets one of these per file the user can swap, each under its own
 * `title` (the Image form's text encoder).
 *
 * @param label - Names the control for screen readers, e.g. "Image model"
 * @param models - What is installed, as the engine reports it
 * @param title - The section's heading, "Model" unless given
 */
export function ModelSelect({
  label,
  models,
  value,
  onChange,
  title = "Model"
}: Readonly<{
  label: string
  models: readonly ModelOption[]
  value: string
  onChange: (id: string) => void
  title?: string
}>) {
  const handleChange = useCallback(
    (key: unknown) => {
      if (typeof key === "string") onChange(key)
    },
    [onChange]
  )

  return (
    <FormSection
      title={title}
      note={models.length > 1 ? `${models.length} installed` : null}>
      <Select
        aria-label={label}
        fullWidth
        variant='secondary'
        placeholder='None installed'
        isDisabled={models.length === 0}
        value={models.some((model) => model.id === value) ? value : null}
        onChange={handleChange}>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {models.map((model) => (
              <ListBox.Item key={model.id} id={model.id} textValue={model.label}>
                {model.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </FormSection>
  )
}
