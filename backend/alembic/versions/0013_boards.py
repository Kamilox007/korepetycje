"""shared whiteboards

Revision ID: 0013
Revises: 0012

Four tables behind the tutoring whiteboard: boards (the token in the link is
the credential), their pages (Excalidraw elements as JSON), pasted files
(bytes on disk, only metadata here) and daily snapshots (recovery from an
accidental select-all + Delete).

Only create_table, so no batch mode needed. The ON DELETE CASCADE clauses
document intent for Postgres; SQLite in this app does not enforce foreign
keys, and purge deletes children explicitly.

Create Date: 2026-09-20
"""
from alembic import op
import sqlalchemy as sa

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'boards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('last_opened_at', sa.DateTime(), nullable=True),
        sa.Column('archived_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], name=op.f('fk_boards_created_by_user_id_users')),
        sa.ForeignKeyConstraint(['student_id'], ['students.id'], name=op.f('fk_boards_student_id_students')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_boards')),
    )
    op.create_index(op.f('ix_boards_archived_at'), 'boards', ['archived_at'], unique=False)
    op.create_index(op.f('ix_boards_created_by_user_id'), 'boards', ['created_by_user_id'], unique=False)
    op.create_index(op.f('ix_boards_student_id'), 'boards', ['student_id'], unique=False)
    op.create_index(op.f('ix_boards_token'), 'boards', ['token'], unique=True)

    op.create_table(
        'board_pages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('board_id', sa.Integer(), nullable=False),
        sa.Column('idx', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('elements', sa.JSON(), nullable=False),
        sa.Column('rev', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], name=op.f('fk_board_pages_board_id_boards'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_board_pages')),
        sa.UniqueConstraint('board_id', 'idx', name='uq_board_pages_board_idx'),
    )
    op.create_index(op.f('ix_board_pages_board_id'), 'board_pages', ['board_id'], unique=False)

    op.create_table(
        'board_files',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('board_id', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.String(length=120), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('mime', sa.String(length=60), nullable=False),
        sa.Column('bytes', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], name=op.f('fk_board_files_board_id_boards'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_board_files')),
        sa.UniqueConstraint('board_id', 'file_id', name='uq_board_files_board_file_id'),
    )
    op.create_index(op.f('ix_board_files_board_id'), 'board_files', ['board_id'], unique=False)
    op.create_index(op.f('ix_board_files_sha256'), 'board_files', ['sha256'], unique=False)

    op.create_table(
        'board_snapshots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('board_id', sa.Integer(), nullable=False),
        sa.Column('page_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('elements', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['board_id'], ['boards.id'], name=op.f('fk_board_snapshots_board_id_boards'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['page_id'], ['board_pages.id'], name=op.f('fk_board_snapshots_page_id_board_pages'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_board_snapshots')),
    )
    op.create_index(op.f('ix_board_snapshots_board_id'), 'board_snapshots', ['board_id'], unique=False)
    op.create_index(op.f('ix_board_snapshots_created_at'), 'board_snapshots', ['created_at'], unique=False)
    op.create_index(op.f('ix_board_snapshots_page_id'), 'board_snapshots', ['page_id'], unique=False)


def downgrade() -> None:
    op.drop_table('board_snapshots')
    op.drop_table('board_files')
    op.drop_table('board_pages')
    op.drop_table('boards')
