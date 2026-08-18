"""session registry

Revision ID: 0005
Revises: 0004

Lets a token be revoked before it expires. Without this table a password change
does not end sessions open on other devices.
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'sessions',
        sa.Column('jti', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('user_agent', sa.String(length=300), nullable=True),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('jti'),
    )
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'])
    op.create_index(op.f('ix_sessions_expires_at'), 'sessions', ['expires_at'])
    # Tokens issued before this migration carry no jti, so get_current_user
    # rejects them. Everyone signs in once more; there is no transitional path
    # to remember to close later.


def downgrade() -> None:
    op.drop_index(op.f('ix_sessions_expires_at'), table_name='sessions')
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_table('sessions')
