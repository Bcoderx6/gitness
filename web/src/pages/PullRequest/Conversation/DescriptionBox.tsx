/*
 * Copyright 2023 Harness, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Button, ButtonSize, ButtonVariation, Container, Layout, useToaster, Text } from '@harnessio/uicore'
import cx from 'classnames'
import { useMutate } from 'restful-react'
import { Color, FontVariation } from '@harnessio/design-system'
import { PopoverPosition } from '@blueprintjs/core'
import { MarkdownViewer } from 'components/MarkdownViewer/MarkdownViewer'
import { useStrings } from 'framework/strings'
import type { OpenapiUpdatePullReqRequest } from 'services/code'
import { OptionsMenuButton } from 'components/OptionsMenuButton/OptionsMenuButton'
import { MarkdownEditorWithPreview } from 'components/MarkdownEditorWithPreview/MarkdownEditorWithPreview'
import { NavigationCheck } from 'components/NavigationCheck/NavigationCheck'
import { CommentBoxOutletPosition, getErrorMessage } from 'utils/Utils'
import Config from 'Config'
import { useAppContext } from 'AppContext'
import type { ConversationProps } from './Conversation'
import css from './Conversation.module.scss'

interface DescriptionBoxProps extends Omit<ConversationProps, 'onCancelEditDescription'> {
  onCancelEditDescription: () => void
}

export const DescriptionBox: React.FC<DescriptionBoxProps> = ({
  repoMetadata,
  pullReqMetadata,
  onDescriptionSaved,
  onCancelEditDescription,
  standalone,
  routingId
}) => {
  const { hooks } = useAppContext()

  const [flag, setFlag] = useState(false)
  const { SEMANTIC_SEARCH_ENABLED } = hooks?.useFeatureFlags()
  const [edit, setEdit] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [originalContent, setOriginalContent] = useState(pullReqMetadata.description as string)
  const [content, setContent] = useState(originalContent)
  const { getString } = useStrings()
  const { showError } = useToaster()

  const { mutate } = useMutate({
    verb: 'PATCH',
    path: `/api/v1/repos/${repoMetadata.path}/+/pullreq/${pullReqMetadata.number}`
  })

  useEffect(() => {
    setEdit(!pullReqMetadata?.description?.length)

    if (pullReqMetadata?.description) {
      setContent(pullReqMetadata?.description)
    }
  }, [pullReqMetadata?.description, pullReqMetadata?.description?.length])

  // write the above function handleCopilotClick in a callback
  const handleCopilotClick = useCallback(() => {
    setFlag(true)
  }, [])

  return (
    <Container className={cx({ [css.box]: !edit, [css.desc]: !edit })}>
      <Container padding={!edit ? { left: 'small', bottom: 'small' } : undefined}>
        {(edit && (
          <MarkdownEditorWithPreview
            routingId={routingId}
            standalone={standalone}
            repoMetadata={repoMetadata}
            value={content}
            flag={flag}
            setFlag={setFlag}
            outlets={{
              [CommentBoxOutletPosition.START_OF_MARKDOWN_EDITOR_TOOLBAR]: (
                <>
                  {SEMANTIC_SEARCH_ENABLED && !standalone ? (
                    <Button
                      size={ButtonSize.SMALL}
                      variation={ButtonVariation.ICON}
                      icon={'harness-copilot'}
                      withoutCurrentColor
                      iconProps={{
                        color: Color.GREY_0,
                        size: 22,
                        className: css.aidaIcon
                      }}
                      className={css.aidaIcon}
                      onClick={handleCopilotClick}
                      tooltip={
                        <Container padding={'small'} width={270}>
                          <Layout.Vertical flex={{ align: 'center-center' }}>
                            <Text font={{ variation: FontVariation.BODY }}>{getString('prGenSummary')}</Text>
                          </Layout.Vertical>
                        </Container>
                      }
                      tooltipProps={{
                        interactionKind: 'hover',
                        usePortal: true,
                        position: PopoverPosition.BOTTOM_LEFT,
                        popoverClassName: cx(css.popover)
                      }}
                    />
                  ) : null}
                </>
              )
            }}
            onSave={value => {
              if (value?.split('\n').some(line => line.length > Config.MAX_TEXT_LINE_SIZE_LIMIT)) {
                return showError(getString('pr.descHasTooLongLine', { max: Config.MAX_TEXT_LINE_SIZE_LIMIT }), 0)
              }

              if (value.length > Config.PULL_REQUEST_DESCRIPTION_SIZE_LIMIT) {
                return showError(
                  getString('pr.descIsTooLong', { max: Config.PULL_REQUEST_DESCRIPTION_SIZE_LIMIT, len: value.length }),
                  0
                )
              }

              const payload: OpenapiUpdatePullReqRequest = {
                title: pullReqMetadata.title,
                description: value || ''
              }
              mutate(payload)
                .then(() => {
                  setContent(value)
                  setOriginalContent(value)
                  setEdit(false)
                  onDescriptionSaved()
                })
                .catch(exception => showError(getErrorMessage(exception), 0, getString('pr.failedToUpdate')))
            }}
            onCancel={() => {
              setContent(originalContent)
              setEdit(false)
              onCancelEditDescription()
            }}
            setDirty={setDirty}
            i18n={{
              placeHolder: getString('pr.enterDesc'),
              tabEdit: getString('write'),
              tabPreview: getString('preview'),
              save: getString('save'),
              cancel: getString('cancel')
            }}
            editorHeight="400px"
            autoFocusAndPosition={true}
          />
        )) || (
          <Container className={css.mdWrapper}>
            <MarkdownViewer source={content} />
            <Container className={css.menuWrapper}>
              <OptionsMenuButton
                isDark={true}
                icon="Options"
                iconProps={{ size: 14 }}
                style={{ padding: '5px' }}
                items={[
                  {
                    text: getString('edit'),
                    className: css.optionMenuIcon,
                    hasIcon: true,
                    iconName: 'Edit',
                    onClick: () => setEdit(true)
                  }
                ]}
              />
            </Container>
          </Container>
        )}
      </Container>
      <NavigationCheck when={dirty} />
    </Container>
  )
}
