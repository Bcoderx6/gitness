import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutate } from 'restful-react'
import ReactDOM from 'react-dom'
import { useInView } from 'react-intersection-observer'
import {
  Button,
  Container,
  FlexExpander,
  ButtonVariation,
  Layout,
  Text,
  ButtonSize,
  useToaster,
  ButtonProps,
  Checkbox
} from '@harnessio/uicore'
import cx from 'classnames'
import { Render } from 'react-jsx-match'
import { Link } from 'react-router-dom'
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui'
import { useStrings } from 'framework/strings'
import { CodeIcon, GitInfoProps } from 'utils/GitUtils'
import { useEventListener } from 'hooks/useEventListener'
import type { DiffFileEntry } from 'utils/types'
import { useConfirmAct } from 'hooks/useConfirmAction'
import { useAppContext } from 'AppContext'
import type { OpenapiCommentCreatePullReqRequest, TypesPullReq, TypesPullReqActivity } from 'services/code'
import { getErrorMessage } from 'utils/Utils'
import { CopyButton } from 'components/CopyButton/CopyButton'
import { AppWrapper } from 'App'
import { NavigationCheck } from 'components/NavigationCheck/NavigationCheck'
import { CodeCommentStatusButton } from 'components/CodeCommentStatusButton/CodeCommentStatusButton'
import { CodeCommentSecondarySaveButton } from 'components/CodeCommentSecondarySaveButton/CodeCommentSecondarySaveButton'
import { CodeCommentStatusSelect } from 'components/CodeCommentStatusSelect/CodeCommentStatusSelect'
import {
  activitiesToDiffCommentItems,
  activityToCommentItem,
  CommentType,
  DIFF2HTML_CONFIG,
  DiffCommentItem,
  DIFF_VIEWER_HEADER_HEIGHT,
  getCommentLineInfo,
  createCommentOppositePlaceHolder,
  ViewStyle,
  contentDOMHasData
} from './DiffViewerUtils'
import { CommentAction, CommentBox, CommentBoxOutletPosition, CommentItem } from '../CommentBox/CommentBox'
import css from './DiffViewer.module.scss'

interface DiffViewerProps extends Pick<GitInfoProps, 'repoMetadata'> {
  diff: DiffFileEntry
  viewStyle: ViewStyle
  stickyTopPosition?: number
  readOnly?: boolean
  pullRequestMetadata?: TypesPullReq
  onCommentUpdate: () => void
  targetRef?: string
  sourceRef?: string
  commitRange?: string[]
  scrollElement: HTMLElement
}

//
// Note: Lots of direct DOM manipulations are used to boost performance.
//       Avoid React re-rendering at all cost as it might cause unresponsive UI
//       when diff content is big, or when a PR has a lot of changed files.
//
export const DiffViewer: React.FC<DiffViewerProps> = ({
  diff,
  viewStyle,
  stickyTopPosition = 0,
  readOnly,
  repoMetadata,
  pullRequestMetadata,
  onCommentUpdate,
  targetRef,
  sourceRef,
  commitRange,
  scrollElement
}) => {
  const { routes } = useAppContext()
  const { getString } = useStrings()
  const viewedPath = useMemo(
    () => `/api/v1/repos/${repoMetadata.path}/+/pullreq/${pullRequestMetadata?.number}/file-views`,
    [repoMetadata.path, pullRequestMetadata?.number]
  )
  const { mutate: markViewed } = useMutate({ verb: 'PUT', path: viewedPath})
  const { mutate: unmarkViewed } = useMutate({ verb: 'DELETE', path: ({ filePath }) => `${viewedPath}/${filePath}` })

  // file viewed feature is only enabled if no commit range is provided (otherwise component is hidden, too)
  const [viewed, setViewed] = useState(commitRange?.length === 0 && diff.fileViews?.get(diff.filePath) === diff.checksumAfter)
  useEffect(() => {
    if (commitRange?.length === 0) {
      setViewed(diff.fileViews?.get(diff.filePath) === diff.checksumAfter)
    }
  },
  [diff.fileViews, diff.filePath, diff.checksumAfter, commitRange])
  
  const [collapsed, setCollapsed] = useState(viewed)
  useEffect(() => {
    setCollapsed(viewed)
  },
  [viewed])
  const [fileUnchanged] = useState(diff.unchangedPercentage === 100)
  const [fileDeleted] = useState(diff.isDeleted)
  const [renderCustomContent, setRenderCustomContent] = useState(fileUnchanged || fileDeleted)
  const [diffRenderer, setDiffRenderer] = useState<Diff2HtmlUI>()
  const { ref: inViewRef, inView } = useInView({ rootMargin: '100px 0px' })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { currentUser, standalone } = useAppContext()
  const { showError } = useToaster()
  const confirmAct = useConfirmAct()
  const commentPath = useMemo(
    () => `/api/v1/repos/${repoMetadata.path}/+/pullreq/${pullRequestMetadata?.number}/comments`,
    [repoMetadata.path, pullRequestMetadata?.number]
  )
  const { mutate: saveComment } = useMutate({ verb: 'POST', path: commentPath })
  const { mutate: updateComment } = useMutate({ verb: 'PATCH', path: ({ id }) => `${commentPath}/${id}` })
  const { mutate: deleteComment } = useMutate({ verb: 'DELETE', path: ({ id }) => `${commentPath}/${id}` })

  const [comments, _setComments] = useState<DiffCommentItem<TypesPullReqActivity>[]>([])
  function setComments(c: DiffCommentItem<TypesPullReqActivity>[]) {
    // no changes in comments? nothing to do
    // NOTE: we only react to new comments as of now, not changes on existing comments or replies, so that's good enough
    if (c.length == comments.length) {
      return
    }

    _setComments(c)
    triggerCodeCommentRendering()
  }
  // use separate flag for monitoring comment rendering as opposed to updating comments to void spamming comment changes
  const [renderComments, _setRenderComments] = useState(0)
  function triggerCodeCommentRendering() {
    _setRenderComments(Date.now())
  }
  useMemo(() => {
    triggerCodeCommentRendering()
  }, [
    viewStyle,
    inView,
    commitRange
  ])

  const [dirty, setDirty] = useState(false)
  const commentsRef = useRef<DiffCommentItem<TypesPullReqActivity>[]>(comments)
  const setContainerRef = useCallback(
    node => {
      containerRef.current = node
      inViewRef(node)
    },
    [inViewRef]
  )
  const contentRef = useRef<HTMLDivElement>(null)
  const setupViewerInitialStates = useCallback(() => {
    setDiffRenderer(
      new Diff2HtmlUI(
        document.getElementById(diff.contentId) as HTMLElement,
        [diff],
        Object.assign({}, DIFF2HTML_CONFIG, { outputFormat: viewStyle })
      )
    )
  }, [diff, viewStyle])
  const renderDiffAndUpdateContainerHeightIfNeeded = useCallback(
    (enforced = false) => {
      const contentDOM = contentRef.current as HTMLDivElement
      const containerDOM = containerRef.current as HTMLDivElement

      if (!contentDOM.dataset.rendered || enforced) {
        if (!renderCustomContent || enforced) {
          containerDOM.style.height = 'auto'
          diffRenderer?.draw()
          triggerCodeCommentRendering()
        }
        
        contentDOM.dataset.rendered = 'true'
      }
    },
    [diffRenderer, renderCustomContent]
  )

  useEffect(() => {
    // no activities or commit range view? no comments!
    if (!diff?.fileActivities || (commitRange?.length || 0) > 0) {
      setComments([])
      return  
    }
    const _comments = activitiesToDiffCommentItems(diff)
    if (_comments.length > 0) {
      setComments(_comments)
    }
  }, [diff?.fileActivities, diff?.fileActivities?.length, commitRange])

  useEffect(
    function createDiffRenderer() {
      if (inView && !diffRenderer) {
        setupViewerInitialStates()
      }
    },
    [inView, diffRenderer, setupViewerInitialStates]
  )

  useEffect(
    function renderInitialContent() {
      if (diffRenderer && inView) {
        renderDiffAndUpdateContainerHeightIfNeeded()
      }
    },
    [inView, diffRenderer, renderDiffAndUpdateContainerHeightIfNeeded]
  )

  useEffect(
    function handleCollapsedState() {
      const containerDOM = containerRef.current as HTMLDivElement & { scrollIntoViewIfNeeded: () => void }
      const { classList: containerClassList, style: containerStyle } = containerDOM

      if (collapsed) {
        containerClassList.add(css.collapsed)

        // Fix scrolling position messes up with sticky header: When content of the diff content
        // is above the diff header, we need to scroll it back to below the header, adjust window
        // scrolling position to avoid the next diff scroll jump
        const { y } = containerDOM.getBoundingClientRect()
        if (y - stickyTopPosition < 1) {
          containerDOM.scrollIntoView()

          if (stickyTopPosition) {
            scrollElement.scroll({ top: scrollElement.scrollTop - stickyTopPosition })
          }
        }

        if (parseInt(containerStyle.height) != DIFF_VIEWER_HEADER_HEIGHT) {
          containerStyle.height = `${DIFF_VIEWER_HEADER_HEIGHT}px`
        }
      } else {
        containerClassList.remove(css.collapsed)

        const newHeight = Number(containerDOM.scrollHeight)
        if (parseInt(containerStyle.height) != newHeight) {
          containerStyle.height = `${newHeight}px`
        }
      }
    },
    [collapsed, stickyTopPosition]
  )

  useEventListener(
    'click',
    useCallback(
      function clickToAddAnnotation(event: MouseEvent) {
        if (readOnly) {
          return
        }

        const target = event.target as HTMLDivElement
        const targetButton = target?.closest('[data-annotation-for-line]') as HTMLDivElement
        const annotatedLineRow = targetButton?.closest('tr') as HTMLTableRowElement

        const commentItem: DiffCommentItem<TypesPullReqActivity> = {
          left: false,
          right: false,
          lineNumber: 0,
          height: 0,
          commentItems: [],
          filePath: ''
        }

        if (targetButton && annotatedLineRow) {
          if (viewStyle === ViewStyle.SIDE_BY_SIDE) {
            const leftParent = targetButton.closest('.d2h-file-side-diff.left')
            commentItem.left = !!leftParent
            commentItem.right = !leftParent
            commentItem.lineNumber = Number(targetButton.dataset.annotationForLine)
          } else {
            const lineInfoTD = targetButton.closest('td')?.previousElementSibling
            const lineNum1 = lineInfoTD?.querySelector('.line-num1')
            const lineNum2 = lineInfoTD?.querySelector('.line-num2')

            // Right has priority
            commentItem.right = !!lineNum2?.textContent
            commentItem.left = !commentItem.right
            commentItem.lineNumber = Number(lineNum2?.textContent || lineNum1?.textContent)
          }
          setComments([...comments, commentItem])
        }
      },
      [viewStyle, readOnly]
    ),
    containerRef.current as HTMLDivElement
  )

  useEffect(
    function renderCodeComments() {
      if (readOnly) {
        return
      }

      // early exit if there's nothing to render on
      if (!contentRef.current || !contentDOMHasData(contentRef.current)) {
        return
      }

      const isSideBySide = viewStyle === ViewStyle.SIDE_BY_SIDE

      // Update latest commentsRef to use it inside CommentBox callbacks
      commentsRef.current = comments

      comments.forEach(comment => {        
        const lineInfo = getCommentLineInfo(contentRef.current, comment, viewStyle)

        // TODO: add support for live updating changes and replies to comment!
        if (!lineInfo.rowElement || lineInfo.hasCommentsRendered) {
          return
        }
        const { rowElement } = lineInfo

        // Mark row that it has comment/annotation
        rowElement.dataset.annotated = 'true'

        // always create placeholder (in memory)
        const oppositeRowPlaceHolder = createCommentOppositePlaceHolder(comment)

        // in split view, actually attach the placeholder
        if (isSideBySide && lineInfo.oppositeRowElement != null) {
            lineInfo.oppositeRowElement.after(oppositeRowPlaceHolder)
        }

        // Create a new row below it and render CommentBox inside
        const commentRowElement = document.createElement('tr')
        commentRowElement.dataset.annotatedLine = String(comment.lineNumber)
        commentRowElement.innerHTML = `<td colspan="2"></td>`
        rowElement.after(commentRowElement)

        const element = commentRowElement.firstElementChild as HTMLTableCellElement
        const resetCommentState = () => {
          // Clean up CommentBox rendering and reset states bound to lineInfo
          ReactDOM.unmountComponentAtNode(element as HTMLDivElement)
          commentRowElement.parentElement?.removeChild(commentRowElement)
          lineInfo.oppositeRowElement?.parentElement?.removeChild(
            oppositeRowPlaceHolder as Element
          )
          delete lineInfo.rowElement.dataset.annotated

          setComments(
              commentsRef.current.filter(item => {
                return item !== comment
              })
            )
        }

        // Note: CommentBox is rendered as an independent React component
        //       everything passed to it must be either values, or refs. If you
        //       pass callbacks or states, they won't be updated and might
        //       cause unexpected bugs
        ReactDOM.unmountComponentAtNode(element as HTMLDivElement)
        ReactDOM.render(
          <AppWrapper>
            <CommentBox
              commentItems={comment.commentItems}
              initialContent={''}
              width={isSideBySide ? 'calc(100vw / 2 - 163px)' : undefined} // TODO: Re-calcualte for standalone version
              onHeightChange={boxHeight => {
                  const first = oppositeRowPlaceHolder?.firstElementChild as HTMLTableCellElement
                  const last = oppositeRowPlaceHolder?.lastElementChild as HTMLTableCellElement
                  if (first && last) {
                    first.style.height = `${boxHeight}px`
                    last.style.height = `${boxHeight}px`
                  }
              }}
              onCancel={resetCommentState}
              setDirty={setDirty}
              currentUserName={currentUser.display_name}
              handleAction={async (action, value, commentItem) => {
                let result = true
                let updatedItem: CommentItem<TypesPullReqActivity> | undefined = undefined
                const id = (commentItem as CommentItem<TypesPullReqActivity>)?.payload?.id

                switch (action) {
                  case CommentAction.NEW: {
                    const payload: OpenapiCommentCreatePullReqRequest = {
                      line_start: comment.lineNumber,
                      line_end: comment.lineNumber,
                      line_start_new: !comment.left,
                      line_end_new: !comment.left,
                      path: diff.filePath,
                      source_commit_sha: sourceRef,
                      target_commit_sha: targetRef,
                      text: value
                    }

                    await saveComment(payload)
                      .then((newComment: TypesPullReqActivity) => {
                        updatedItem = activityToCommentItem(newComment)

                        // remove item (to refresh all comment refrences and remove it from rendering)
                        resetCommentState()

                        // add comment to file activities (will re-create comments and render new one)
                        diff.fileActivities?.push(newComment)
                      })
                      .catch(exception => {
                        result = false
                        showError(getErrorMessage(exception), 0)
                      })
                    break
                  }

                  case CommentAction.REPLY: {
                    await saveComment({
                      type: CommentType.CODE_COMMENT,
                      text: value,
                      parent_id: Number(commentItem?.payload?.id as number)
                    })
                      .then(newComment => {
                        updatedItem = activityToCommentItem(newComment)
                        diff.fileActivities?.push(newComment)
                      })
                      .catch(exception => {
                        result = false
                        showError(getErrorMessage(exception), 0)
                      })
                    break
                  }

                  case CommentAction.DELETE: {
                    result = false
                    await confirmAct({
                      message: getString('deleteCommentConfirm'),
                      action: async () => {
                        await deleteComment({}, { pathParams: { id } })
                          .then(() => {
                            result = true
                          })
                          .catch(exception => {
                            result = false
                            showError(getErrorMessage(exception), 0, getString('pr.failedToDeleteComment'))
                          })
                      }
                    })
                    break
                  }

                  case CommentAction.UPDATE: {
                    await updateComment({ text: value }, { pathParams: { id } })
                      .then(newComment => {
                        updatedItem = activityToCommentItem(newComment)
                      })
                      .catch(exception => {
                        result = false
                        showError(getErrorMessage(exception), 0)
                      })
                    break
                  }
                }

                if (result) {
                  onCommentUpdate()
                }

                return [result, updatedItem]
              }}
              outlets={{
                [CommentBoxOutletPosition.LEFT_OF_OPTIONS_MENU]: (
                  <CodeCommentStatusSelect
                    repoMetadata={repoMetadata}
                    pullRequestMetadata={pullRequestMetadata as TypesPullReq}
                    onCommentUpdate={onCommentUpdate}
                    commentItems={comment.commentItems}
                  />
                ),
                [CommentBoxOutletPosition.LEFT_OF_REPLY_PLACEHOLDER]: (
                  <CodeCommentStatusButton
                    repoMetadata={repoMetadata}
                    pullRequestMetadata={pullRequestMetadata as TypesPullReq}
                    onCommentUpdate={onCommentUpdate}
                    commentItems={comment.commentItems}
                  />
                ),
                [CommentBoxOutletPosition.BETWEEN_SAVE_AND_CANCEL_BUTTONS]: (props: ButtonProps) => (
                  <CodeCommentSecondarySaveButton
                    repoMetadata={repoMetadata}
                    pullRequestMetadata={pullRequestMetadata as TypesPullReq}
                    commentItems={comment.commentItems}
                    {...props}
                  />
                )
              }}
              autoFocusAndPositioning
            />
          </AppWrapper>,
          element
        )
      })
    },
    [
      renderComments,
    ]
  )

  useEffect(function cleanUpCommentBoxRendering() {
    const contentDOM = contentRef.current
    return () => {
      contentDOM
        ?.querySelectorAll('[data-annotated-line]')
        .forEach(element => ReactDOM.unmountComponentAtNode(element.firstElementChild as HTMLTableCellElement))
    }
  }, [])

  return (
    <Container
      ref={setContainerRef}
      id={diff.containerId}
      className={cx(css.main, { [css.readOnly]: readOnly })}
      style={{ '--diff-viewer-sticky-top': `${stickyTopPosition}px` } as React.CSSProperties}>
      <Layout.Vertical>
        <Container className={css.diffHeader} height={DIFF_VIEWER_HEADER_HEIGHT}>
          <Layout.Horizontal>
            <Button
              variation={ButtonVariation.ICON}
              icon={collapsed ? 'main-chevron-right' : 'main-chevron-down'}
              size={ButtonSize.SMALL}
              onClick={() => setCollapsed(!collapsed)}
              iconProps={{
                  size: 10,
                  style: {
                    color: '#383946',
                    flexGrow: 1,
                    justifyContent: 'center',
                    display: 'flex'
                  }
                }
              }
              className={css.chevron}
            />
            <Text inline className={css.fname}>
              <Link
                to={routes.toCODERepository({
                  repoPath: repoMetadata.path as string,
                  gitRef: pullRequestMetadata?.source_branch,
                  resourcePath: diff.isRename ? diff.newName : diff.filePath
                })}>
                {diff.isRename ? `${diff.oldName} -> ${diff.newName}` : diff.filePath}
              </Link>
              <CopyButton content={diff.filePath} icon={CodeIcon.Copy} size={ButtonSize.SMALL} />
            </Text>
            <Container style={{ alignSelf: 'center' }} padding={{ left: 'small' }}>
              <Layout.Horizontal spacing="xsmall">
                <Render when={diff.addedLines || diff.isNew}>
                  <Text tag="span" className={css.addedLines}>
                    +{diff.addedLines || 0}
                  </Text>
                </Render>
                <Render when={diff.deletedLines || diff.isDeleted}>
                  <Text tag="span" className={css.deletedLines}>
                    -{diff.deletedLines || 0}
                  </Text>
                </Render>
              </Layout.Horizontal>
            </Container>
            <FlexExpander />

            <Render when={!readOnly && commitRange?.length === 0 && diff.fileViews?.get(diff.filePath) !== undefined && diff.fileViews?.get(diff.filePath) !== diff.checksumAfter}>
              <Container>
                <Text className={css.fileChanged}>
                {getString('changedSinceLastView')}
                </Text>
              </Container>
            </Render>

            <Render when={!readOnly && commitRange?.length === 0 }>
              <Container>
                <label className={css.viewLabel}>
                  <Checkbox
                    checked={viewed}
                    onChange={async () => {
                      if (viewed) {
                        setViewed(false)

                        // update local data first
                        diff.fileViews?.delete(diff.filePath)

                        // best effort attempt to recflect on server (swallow exception - user still sees correct data locally)
                        await unmarkViewed(null, { pathParams: { filePath: diff.filePath } }).catch(() =>{})
                      } else {
                        setViewed(true)

                        // update local data first
                        // we could wait for server response for the guaranteed correct SHA, but this is non-crucial data so it's okay
                        diff.fileViews?.set(diff.filePath, diff.checksumAfter || "unknown")

                        // best effort attempt to recflect on server (swallow exception - user still sees correct data locally)
                        await markViewed({
                          path: diff.filePath,
                          commit_sha: pullRequestMetadata?.source_sha
                        }, {}).catch(() =>{})
                      }
                    }}
                  />
                  {getString('viewed')}
                </label>
              </Container>
            </Render>
          </Layout.Horizontal>
        </Container>

        <Container
          id={diff.contentId}
          className={cx(css.diffContent, { [css.standalone]: standalone })}
          ref={contentRef}>
          <Render when={renderCustomContent}>
            <Container>
              <Layout.Vertical padding="xlarge" style={{ alignItems: 'center' }}>
                <Render when={fileDeleted}>
                  <Button
                    variation={ButtonVariation.LINK}
                    onClick={() => {
                      setRenderCustomContent(false)
                      setTimeout(() => renderDiffAndUpdateContainerHeightIfNeeded(true), 0)
                    }}>
                    {getString('pr.showDiff')}
                  </Button>
                </Render>
                <Text>{getString(fileDeleted ? 'pr.fileDeleted' : 'pr.fileUnchanged')}</Text>
              </Layout.Vertical>
            </Container>
          </Render>
        </Container>
      </Layout.Vertical>
      <NavigationCheck when={dirty} />
    </Container>
  )
}
