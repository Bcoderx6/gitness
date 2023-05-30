// Copyright 2022 Harness Inc. All rights reserved.
// Use of this source code is governed by the Polyform Free Trial License
// that can be found in the LICENSE.md file for this repository.

package check

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/harness/gitness/gitrpc"
	"github.com/harness/gitness/internal/api/usererror"
	"github.com/harness/gitness/internal/auth"
	"github.com/harness/gitness/types"
	"github.com/harness/gitness/types/enum"
)

type ReportInput struct {
	CheckUID string             `json:"check_uid"`
	Status   enum.CheckStatus   `json:"status"`
	Summary  string             `json:"summary"`
	Link     string             `json:"link"`
	Payload  types.CheckPayload `json:"payload"`
}

var regexpCheckUID = "^[a-zA-Z_][0-9a-zA-Z-_.$]{0,127}$"
var matcherCheckUID = regexp.MustCompile(regexpCheckUID)

// Validate validates and sanitizes the ReportInput data.
func (in *ReportInput) Validate() error {
	if in.CheckUID == "" {
		return usererror.BadRequest("Status check UID is missing")
	}

	if !matcherCheckUID.MatchString(in.CheckUID) {
		return usererror.BadRequestf("Status check UID must match the regular expression: %s", regexpCheckUID)
	}

	_, ok := in.Status.Sanitize()
	if !ok {
		return usererror.BadRequest("Invalid value provided for status check status")
	}

	payloadKind, ok := in.Payload.Kind.Sanitize()
	if !ok {
		return usererror.BadRequest("Invalid value provided for the payload type")
	}
	in.Payload.Kind = payloadKind

	switch in.Payload.Kind {
	case enum.CheckPayloadKindExternal:
		// the default external type does not support payload: clear it here
		in.Payload.Version = ""
		in.Payload.Data = []byte{'{', '}'}

		if in.Link == "" { // the link is mandatory for the external
			return usererror.BadRequest("Link is missing")
		}
	}

	return nil
}

// Report modifies an existing or creates a new (if none yet exists) status check report for a specific commit.
func (c *Controller) Report(
	ctx context.Context,
	session *auth.Session,
	repoRef string,
	commitSHA string,
	in *ReportInput,
	metadata map[string]string,
) (*types.Check, error) {
	repo, err := c.getRepoCheckAccess(ctx, session, repoRef, enum.PermissionCommitCheckReport)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire access access to repo: %w", err)
	}

	if errValidate := in.Validate(); errValidate != nil {
		return nil, errValidate
	}

	if !gitrpc.ValidateCommitSHA(commitSHA) {
		return nil, usererror.BadRequest("invalid commit SHA provided")
	}

	_, err = c.gitRPCClient.GetCommit(ctx, &gitrpc.GetCommitParams{
		ReadParams: gitrpc.ReadParams{RepoUID: repo.GitUID},
		SHA:        commitSHA,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to commit sha=%s: %w", commitSHA, err)
	}

	now := time.Now().UnixMilli()

	metadataJson, _ := json.Marshal(metadata)

	statusCheckReport := &types.Check{
		CreatedBy:  session.Principal.ID,
		Created:    now,
		Updated:    now,
		RepoID:     repo.ID,
		CommitSHA:  commitSHA,
		UID:        in.CheckUID,
		Status:     in.Status,
		Summary:    in.Summary,
		Link:       in.Link,
		Payload:    in.Payload,
		Metadata:   metadataJson,
		ReportedBy: *session.Principal.ToPrincipalInfo(),
	}

	err = c.checkStore.Upsert(ctx, statusCheckReport)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert status check result for repo=%s: %w", repo.UID, err)
	}

	return statusCheckReport, nil
}
