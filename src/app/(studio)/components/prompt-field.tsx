"use client"

import { Button, Modal, TextArea, useOverlayState } from "@heroui/react"
import { Fullscreen } from "@keyline-icons/react"
import { useCallback, useState } from "react"

/**
 * A form's prompt: a text area, with a button in its corner that opens the prompt in a dialog with more
 * room and larger text. Made for react-hook-form's `Controller`, whose `field` it takes as it is.
 *
 * The dialog edits a copy. Apply puts the copy in the form, and the close button drops it. A click
 * outside and Escape do nothing, so a long edit is never lost or half kept by a stray click or key.
 *
 * @param label - Names the prompt for screen readers, and heads the dialog
 */
export function PromptField({
  label,
  placeholder,
  name,
  value,
  disabled,
  onChange,
  onBlur,
  ref
}: Readonly<{
  label: string
  placeholder: string
  name: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onBlur: () => void
  ref?: React.Ref<HTMLTextAreaElement>
}>) {
  const dialog = useOverlayState()
  const [draft, setDraft] = useState(value)

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    [onChange]
  )
  const handleDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
    []
  )
  const handleExpand = useCallback(() => {
    setDraft(value)
    dialog.open()
  }, [value, dialog])
  const handleApply = useCallback(() => {
    onChange(draft)
    dialog.close()
  }, [draft, onChange, dialog])
  // The dialog opens with the caret after the text, to carry on writing. A stable callback runs once, when
  // the text area mounts with the dialog
  const placeCaretAtEnd = useCallback((node: HTMLTextAreaElement | null) => {
    node?.setSelectionRange(node.value.length, node.value.length)
  }, [])

  return (
    <div className='relative'>
      <TextArea
        ref={ref}
        aria-label={label}
        fullWidth
        rows={6}
        variant='secondary'
        className='resize-y pr-12'
        name={name}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={handleChange}
        onBlur={onBlur}
      />
      <Button
        isIconOnly
        size='sm'
        variant='ghost'
        aria-label={`Expand ${label.toLowerCase()}`}
        isDisabled={disabled}
        className='absolute top-1.5 right-3'
        onPress={handleExpand}>
        <Fullscreen size={15} strokeWidth={1.75} />
      </Button>

      <Modal.Backdrop
        isOpen={dialog.isOpen}
        onOpenChange={dialog.setOpen}
        isDismissable={false}
        isKeyboardDismissDisabled>
        <Modal.Container size='lg'>
          <Modal.Dialog className='max-w-2xl'>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{label}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextArea
                ref={placeCaretAtEnd}
                aria-label={label}
                autoFocus
                fullWidth
                variant='secondary'
                className='h-[60svh] resize-none text-base'
                placeholder={placeholder}
                value={draft}
                onChange={handleDraftChange}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button fullWidth onPress={handleApply}>
                Apply
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  )
}
