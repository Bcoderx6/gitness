import { Link } from 'react-router-dom'
import { Container, Layout } from '@harnessio/uicore'
import { useAppContext } from 'AppContext'
import type { GitInfoProps } from 'utils/GitUtils'
import { PullRequestSection } from 'utils/Utils'
interface CodeCommentHeaderProps extends Pick<GitInfoProps, 'repoMetadata' | 'pullRequestMetadata'> {
export const CodeCommentHeader: React.FC<CodeCommentHeaderProps> = ({
  commentItems,
  threadId,
  repoMetadata,
  pullRequestMetadata
}) => {
  const { routes } = useAppContext()
          <Link
            className={css.fname}
            to={`${routes.toCODEPullRequest({
              repoPath: repoMetadata?.path as string,
              pullRequestId: String(pullRequestMetadata?.number),
              pullRequestSection: PullRequestSection.FILES_CHANGED
            })}?path=${commentItems[0].payload?.code_comment?.path}&commentId=${commentItems[0].payload?.id}`}>
          </Link>