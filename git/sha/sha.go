// Package sha provides functionality for working with Git SHA values.
//
// Copyright 2023 Harness, Inc.
// Licensed under the Apache License, Version 2.0 (the "License").
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
package sha

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// SHA represents a git sha.
type SHA struct {
	str string
}

// EmptyTree is the SHA of an empty tree.
const EmptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

var (
	// Nil represents a nil SHA value.
	Nil = Must("0000000000000000000000000000000000000000")
	// None represents an empty SHA value.
	None = SHA{}
	// validSHARegex defines the valid SHA format accepted by Git (full form and short forms).
	validSHARegex = regexp.MustCompile("^[0-9a-f]{4,64}$")
	nilRegex      = regexp.MustCompile("^0{4,64}$")
)

// New creates a new SHA instance from the provided string value.
func New(value string) (SHA, error) {
	value = strings.TrimSpace(value)
	value = strings.ToLower(value)
	if !validSHARegex.MatchString(value) {
		return SHA{}, fmt.Errorf("invalid argument: the provided commit sha '%s' is of invalid format", value)
	}
	return SHA{
		str: value,
	}, nil
}

// Must creates a new SHA instance from the provided string value and panics if an error occurs.
func Must(value string) SHA {
	sha, err := New(value)
	if err != nil {
		panic(fmt.Sprintf("invalid SHA: %s", err))
	}
	return sha
}

// IsNil returns whether this SHA is all zeroes.
func (s SHA) IsNil() bool {
	return nilRegex.MatchString(s.str)
}

// IsEmpty returns whether this SHA is an empty string.
func (s SHA) IsEmpty() bool {
	return s.str == ""
}

// Equal checks if two SHA values are equal.
func (s SHA) Equal(val SHA) bool {
	return s.str == val.str
}

// String returns the string representation of the SHA.
func (s SHA) String() string {
	return s.str
}

// GobEncode encodes the SHA value for Gob serialization.
func (s SHA) GobEncode() ([]byte, error) {
	buffer := &bytes.Buffer{}
	err := gob.NewEncoder(buffer).Encode(s.str)
	if err != nil {
		return nil, fmt.Errorf("failed to pack sha value: %w", err)
	}
	return buffer.Bytes(), nil
}

// GobDecode decodes the SHA value from Gob serialization.
func (s *SHA) GobDecode(data []byte) error {
	var str string
	if err := gob.NewDecoder(bytes.NewReader(data)).Decode(&str); err != nil {
		return fmt.Errorf("failed to unpack sha value: %w", err)
	}
	s.str = str
	return nil
}

// MarshalJSON marshals the SHA value to JSON format.
func (s SHA) MarshalJSON() ([]byte, error) {
	return json.Marshal(s.str)
}

// UnmarshalJSON unmarshals the SHA value from JSON format.
func (s *SHA) UnmarshalJSON(data []byte) error {
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		return err
	}
	sha, err := New(str)
	if err != nil {
		return err
	}
	s.str = sha.str
	return nil
}
