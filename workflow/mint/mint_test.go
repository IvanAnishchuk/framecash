package mint

import (
	"math/big"
	"testing"

	bls12381 "github.com/consensys/gnark-crypto/ecc/bls12-381"
)

// The framecash ladder: 0.001, 0.01, 0.1 and 1 ETH. lib/src/ladder.ts and
// FramePool.mintable carry the same numbers.
func ladder(t *testing.T) *Mint {
	t.Helper()
	milli := new(big.Int).Exp(big.NewInt(10), big.NewInt(15), nil)
	var keys []*Key
	for i, d := range []int64{1, 10, 100, 1000} {
		k, err := NewKey(new(big.Int).Mul(milli, big.NewInt(d)), big.NewInt(int64(1000+i)))
		if err != nil {
			t.Fatal(err)
		}
		keys = append(keys, k)
	}
	m, err := New(keys)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func eth(milli int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(milli), new(big.Int).Exp(big.NewInt(10), big.NewInt(15), nil))
}

func TestMintableTakesOneRung(t *testing.T) {
	m := ladder(t)
	cases := []struct{ in, want *big.Int }{
		{eth(1), eth(0)},
		{eth(2), eth(1)},
		{eth(123), eth(122)},
		{new(big.Int).Add(eth(12), big.NewInt(999)), eth(11)},
	}
	for _, c := range cases {
		if got := m.Mintable(c.in); got.Cmp(c.want) != 0 {
			t.Errorf("Mintable(%s) = %s, want %s", c.in, got, c.want)
		}
	}
}

// The CLI demo deposits 0.123 ETH and the local mint answers 0.1 + 2×0.01 + 2×0.001.
// The CRE mint must give the same split, or a client that switches mints sees different notes.
func TestSplitMatchesTheLocalMint(t *testing.T) {
	got, err := ladder(t).Split(eth(123), 7)
	if err != nil {
		t.Fatal(err)
	}
	want := []*big.Int{eth(100), eth(10), eth(10), eth(1), eth(1)}
	if len(got) != len(want) {
		t.Fatalf("split = %v, want %v", got, want)
	}
	for i := range want {
		if got[i].Cmp(want[i]) != 0 {
			t.Fatalf("split = %v, want %v", got, want)
		}
	}
}

func TestSplitRefusesTooFewPoints(t *testing.T) {
	if _, err := ladder(t).Split(eth(123), 4); err == nil {
		t.Fatal("a 5-note split fitted in 4 points")
	}
}

func TestBlindSignIsScalarMultiplication(t *testing.T) {
	m := ladder(t)
	_, _, _, g2 := bls12381.Generators()
	notes, err := m.SignDeposit(eth(2), [][]byte{EncodeG2(&g2)})
	if err != nil {
		t.Fatal(err)
	}
	var want bls12381.G2Affine
	want.ScalarMultiplication(&g2, big.NewInt(1000)) // the 0.001 key's scalar
	if string(notes[0].BlindSig) != string(EncodeG2(&want)) {
		t.Fatal("blind signature is not sk·B")
	}
}
