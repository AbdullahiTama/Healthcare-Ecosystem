import { Modal, Loading, ErrorState } from '../../components/ui'
import PostCard from './PostCard.jsx'

// Full-content overlay for exactly one post. Reuses the same PostCard
// renderer as the feed list in non-preview mode (no clamp, no "See more"),
// so the feed, the modal and any future surface stay in lock-step.
//
// The modal is opened two ways:
//  1. "See more" on a clamped feed card (post already enriched, no fetch).
//  2. A deep link (?post=<id>) — the post arrives asynchronously, so the
//     modal shows a loading state first and an error state when the post
//     was deleted / is unreachable.
//
// `cardProps` is every PostCard prop except `post` and `preview`; the feed
// owns those values (counts, handlers, comment state) so both surfaces share
// the exact same engagement bar and comment thread.
export default function PostDetailModal({
  show,
  post,
  loading = false,
  error = '',
  onClose,
  cardProps = {},
}) {
  return (
    <Modal show={show} onClose={onClose} title="Post">
      {loading ? (
        <div style={{ padding: '20px 0' }}>
          <Loading text="Loading post..." />
        </div>
      ) : error ? (
        <div style={{ padding: '20px 0' }}>
          <ErrorState variant="app" message={error} />
        </div>
      ) : post ? (
        <div style={{ margin: '-4px -8px -8px' }}>
          <PostCard {...cardProps} post={post} preview={false} />
        </div>
      ) : null}
    </Modal>
  )
}