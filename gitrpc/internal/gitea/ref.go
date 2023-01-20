// Copyright 2022 Harness Inc. All rights reserved.
// Use of this source code is governed by the Polyform Free Trial License
// that can be found in the LICENSE.md file for this repository.

package gitea

import (
	"context"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/harness/gitness/gitrpc/enum"
	"github.com/harness/gitness/gitrpc/internal/types"

	gitea "code.gitea.io/gitea/modules/git"
	gitearef "code.gitea.io/gitea/modules/git/foreachref"
)

func DefaultInstructor(_ types.WalkReferencesEntry) (types.WalkInstruction, error) {
	return types.WalkInstructionHandle, nil
}

// WalkReferences uses the provided options to filter the available references of the repo,
// and calls the handle function for every matching node.
// The instructor & handler are called with a map that contains the matching value for every field provided in fields.
// TODO: walkGiteaReferences related code should be moved to separate file.
func (g Adapter) WalkReferences(ctx context.Context,
	repoPath string, handler types.WalkReferencesHandler, opts *types.WalkReferencesOptions) error {
	// backfil optional options
	if opts.Instructor == nil {
		opts.Instructor = DefaultInstructor
	}
	if len(opts.Fields) == 0 {
		opts.Fields = []types.GitReferenceField{types.GitReferenceFieldRefName, types.GitReferenceFieldObjectName}
	}
	if opts.MaxWalkDistance <= 0 {
		opts.MaxWalkDistance = math.MaxInt32
	}
	if opts.Patterns == nil {
		opts.Patterns = []string{}
	}
	if string(opts.Sort) == "" {
		opts.Sort = types.GitReferenceFieldRefName
	}

	// prepare for-each-ref input
	sortArg := mapToGiteaReferenceSortingArgument(opts.Sort, opts.Order)
	rawFields := make([]string, len(opts.Fields))
	for i := range opts.Fields {
		rawFields[i] = string(opts.Fields[i])
	}
	giteaFormat := gitearef.NewFormat(rawFields...)

	// initializer pipeline for output processing
	pipeOut, pipeIn := io.Pipe()
	defer pipeOut.Close()
	defer pipeIn.Close()
	stderr := strings.Builder{}
	rc := &gitea.RunOpts{Dir: repoPath, Stdout: pipeIn, Stderr: &stderr}

	go func() {
		// create array for args as patterns have to be passed as separate args.
		args := []string{
			"for-each-ref",
			"--format",
			giteaFormat.Flag(),
			"--sort",
			sortArg,
			"--count",
			fmt.Sprint(opts.MaxWalkDistance),
			"--ignore-case",
		}
		args = append(args, opts.Patterns...)
		err := gitea.NewCommand(ctx, args...).Run(rc)
		if err != nil {
			_ = pipeIn.CloseWithError(gitea.ConcatenateError(err, stderr.String()))
		} else {
			_ = pipeIn.Close()
		}
	}()

	parser := giteaFormat.Parser(pipeOut)
	return walkGiteaReferenceParser(parser, handler, opts)
}

func walkGiteaReferenceParser(parser *gitearef.Parser, handler types.WalkReferencesHandler,
	opts *types.WalkReferencesOptions) error {
	for i := int32(0); i < opts.MaxWalkDistance; i++ {
		// parse next line - nil if end of output reached or an error occurred.
		rawRef := parser.Next()
		if rawRef == nil {
			break
		}

		// convert to correct map.
		ref, err := mapGiteaRawRef(rawRef)
		if err != nil {
			return err
		}

		// check with the instructor on the next instruction.
		instruction, err := opts.Instructor(ref)
		if err != nil {
			return fmt.Errorf("error getting instruction: %w", err)
		}

		if instruction == types.WalkInstructionSkip {
			continue
		}
		if instruction == types.WalkInstructionStop {
			break
		}

		// otherwise handle the reference.
		err = handler(ref)
		if err != nil {
			return fmt.Errorf("error handling reference: %w", err)
		}
	}

	if err := parser.Err(); err != nil {
		return processGiteaErrorf(err, "failed to parse reference walk output")
	}

	return nil
}

func (g Adapter) GetRef(ctx context.Context, repoPath, refName string, refType enum.RefType) (string, error) {
	refName, errRef := getRef(refName, refType)
	if errRef != nil {
		return "", errRef
	}

	cmd := gitea.NewCommand(ctx, "show-ref", "--verify", "-s", "--", refName)
	stdout, _, err := cmd.RunStdString(&gitea.RunOpts{
		Dir: repoPath,
	})
	if err != nil {
		if err.IsExitCode(128) && strings.Contains(err.Stderr(), "not a valid ref") {
			return "", types.ErrNotFound
		}
		return "", err
	}

	return strings.TrimSpace(stdout), nil
}

func (g Adapter) UpdateRef(ctx context.Context,
	repoPath, refName string, refType enum.RefType,
	newValue, oldValue string,
) error {
	refName, errRef := getRef(refName, refType)
	if errRef != nil {
		return errRef
	}

	args := make([]string, 0, 4)
	args = append(args, "update-ref", refName, newValue)
	if oldValue != "" {
		args = append(args, oldValue)
	}

	cmd := gitea.NewCommand(ctx, args...)
	_, _, err := cmd.RunStdString(&gitea.RunOpts{
		Dir: repoPath,
	})
	if err != nil {
		if err.IsExitCode(128) {
			return types.ErrNotFound
		}
		return err
	}

	return nil
}

func getRef(refName string, refType enum.RefType) (string, error) {
	const (
		refPullReqPrefix      = "refs/pullreq/"
		refPullReqHeadSuffix  = "/head"
		refPullReqMergeSuffix = "/merge"
	)

	switch refType {
	case enum.RefTypeRaw:
		return refName, nil
	case enum.RefTypeBranch:
		return gitea.BranchPrefix + refName, nil
	case enum.RefTypeTag:
		return gitea.TagPrefix + refName, nil
	case enum.RefTypePullReqHead:
		return refPullReqPrefix + refName + refPullReqHeadSuffix, nil
	case enum.RefTypePullReqMerge:
		return refPullReqPrefix + refName + refPullReqMergeSuffix, nil
	default:
		return "", types.ErrInvalidArgument
	}
}
